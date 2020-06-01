// node-getfilelist: This is a Node.js module to retrieve the file list with the folder tree from the specific folder of Google Drive.
const { google } = require("googleapis");
let driveIdForgetfilelist = "";

async function getList(drive, ptoken, q, fields) {
  const params = {
    q: q,
    fields: fields,
    orderBy: "name",
    pageSize: 1000,
    pageToken: ptoken || "",
    includeItemsFromAllDrives: true,
    supportsAllDrives: true,
  };
  if (driveIdForgetfilelist) {
    params.driveId = driveIdForgetfilelist;
    params.corpora = "drive";
  }
  const res = await drive.files.list(params);
  return res;
}

async function getListLoop(drive, q, fields, list) {
  let NextPageToken = "";
  do {
    const res = await getList(drive, NextPageToken, q, fields);
    Array.prototype.push.apply(list, res.data.files);
    NextPageToken = res.data.nextPageToken;
  } while (NextPageToken);
  return list;
}

async function getFilesFromFolder(obj) {
  const e = obj.e;
  const folderTree = obj.folderTree;
  const service = e.service;
  let f = {
    // searchedFolder: e.searchFolder,
    searchedFolder: e.searchedFolder, // e.searchedFolderにする必要があると思われる。
    folderTree: folderTree,
    fileList: [],
  };
  const fields = (() => {
    if (!e.fields) {
      return "files(createdTime,description,id,mimeType,modifiedTime,name,owners,parents,permissions,shared,size,webContentLink,webViewLink),nextPageToken";
    }
    if (!~e.fields.indexOf("nextPageToken")) {
      e.fields += ",nextPageToken";
    }
    return e.fields;
  })();
  for (let i = 0; i < folderTree.folders.length; i++) {
    const id = folderTree.folders[i];
    const q =
      "'" +
      id +
      "' in parents and mimeType != 'application/vnd.google-apps.folder' and trashed=false";
    const fm = await getListLoop(service, q, fields, []);
    let fe = { files: [] };
    fe.folderTree = folderTree.id[i];
    fe.files = fe.files.concat(fm);
    f.fileList.push(fe);
  }
  f.totalNumberOfFolders = f.folderTree.folders.length;
  f.totalNumberOfFiles = (() => {
    return f.fileList.reduce((c, f) => {
      c += f.files.length;
      return c;
    }, 0);
  })();
  return f;
}

function getDlFoldersS(searchFolderName, fr) {
  let fT = { id: [], names: [], folders: [] };
  fT.id.push([fr.search]);
  fT.names.push(searchFolderName);
  fT.folders.push(fr.search);
  for (let i = 0; i < fr.temp.length; i++) {
    let e = fr.temp[i];
    for (let j = 0; j < e.length; j++) {
      let f = e[j];
      fT.folders.push(f.id);
      let tmp = [];
      fT.id.push(tmp.concat(f.tree).concat(f.id));
      fT.names.push(f.name);
    }
  }
  return fT;
}

async function getAllfoldersRecursively(drive, id, parents, folders) {
  const q = `'${id}' in parents and mimeType='application/vnd.google-apps.folder' and trashed=false`;
  const fields = "files(id,mimeType,name,parents,size),nextPageToken";
  const files = await getListLoop(drive, q, fields, []);
  const temp = files.map((e) => {
    return {
      name: e.name,
      id: e.id,
      parent: e.parents[0],
      tree: parents.concat(id),
    };
  });
  if (temp.length > 0) {
    folders.temp.push(temp);
    for (let i = 0; i < temp.length; i++) {
      await getAllfoldersRecursively(drive, temp[i].id, temp[i].tree, folders);
    }
  }
  return folders;
}

function getFolderTreeRecursively(e, callback) {
  let folderTr = { search: e.searchedFolder.id, temp: [] };
  getAllfoldersRecursively(e.service, e.searchedFolder.id, [], folderTr)
    .then((value) => {
      const res = getDlFoldersS(e.searchedFolder.name, value);
      callback(null, res);
    })
    .catch((err) => {
      callback(err, null);
    });
}

function createFolderTreeID(fm, id, parents, fls) {
  const temp = fm.reduce((ar, e, i) => {
    if ("parents" in e && e.parents.length > 0 && e.parents[0] == id) {
      const t = {
        name: e.name,
        id: e.id,
        parent: e.parents[0],
        tree: parents.concat(id),
      };
      ar.push(t);
    }
    return ar;
  }, []);
  if (temp.length > 0) {
    fls.temp.push(temp);
    for (let i = 0; i < temp.length; i++) {
      createFolderTreeID(fm, temp[i].id, temp[i].tree, fls);
    }
  }
  return fls;
}

function getFromAllFolders(e, callback) {
  const q = "mimeType='application/vnd.google-apps.folder' and trashed=false";
  const fields = "files(id,mimeType,name,parents,size),nextPageToken";
  getListLoop(e.service, q, fields, [])
    .then((files) => {
      let tr = { search: e.searchedFolder.id, temp: [] };
      const value = createFolderTreeID(files, e.searchedFolder.id, [], tr);
      const res = getDlFoldersS(e.searchedFolder.name, value);
      callback(null, res);
    })
    .catch((err) => {
      callback(err, null);
    });
}

function checkauth(auth) {
  if (auth instanceof Object) {
    if ("credentials" in auth && "access_token" in auth.credentials) {
      return true;
    } else if ("key" in auth && "email" in auth) {
      return true;
    }
  }
  return false;
}

async function getFileInf(drive, id) {
  const params = {
    fileId: id,
    fields:
      "createdTime,id,mimeType,modifiedTime,name,owners,parents,shared,webContentLink,webViewLink,driveId",
    supportsAllDrives: true,
  };
  return await drive.files.get(params);
}

function init(e, callback) {
  const chkAuth = checkauth(e.auth);
  const rootId = e.id.toLowerCase() == "root";
  if (!chkAuth && rootId) {
    callback(
      "All folders in Google Drive cannot be retrieved using API key. Please use OAuth2.",
      null
    );
    return;
  }
  e.service = google.drive({ version: "v3", auth: e.auth });
  getFileInf(e.service, e.id)
    .then((r) => {
      e.searchedFolder = r.data;
      driveIdForgetfilelist = r.data.driveId;
      e.method = (chkAuth || rootId) && !e.searchedFolder.shared;
      callback(null, e);
    })
    .catch((err) => {
      callback(err, null);
    });
}

function getFileList(params, callback) {
  init(params, function (err, e) {
    if (err) {
      callback(err, null);
      return;
    }
    if (e.method) {
      getFromAllFolders(e, function (err, folderTree) {
        if (err) {
          callback(err, null);
          return;
        }
        getFilesFromFolder({ e: e, folderTree: folderTree })
          .then((res) => {
            callback(null, res);
          })
          .catch((err) => {
            callback(err, null);
          });
      });
    } else {
      getFolderTreeRecursively(e, function (err, folderTree) {
        if (err) {
          callback(err, null);
          return;
        }
        getFilesFromFolder({ e: e, folderTree: folderTree })
          .then((res) => {
            callback(null, res);
          })
          .catch((err) => {
            callback(err, null);
          });
      });
    }
  });
}

function getFolderTree(params, callback) {
  init(params, function (err, e) {
    if (err) {
      callback(err, null);
      return;
    }
    if (e.method) {
      getFromAllFolders(e, function (err, folderTree) {
        if (err) {
          callback(err, null);
          return;
        }
        callback(null, folderTree);
      });
    } else {
      getFolderTreeRecursively(e, function (err, folderTree) {
        if (err) {
          callback(err, null);
          return;
        }
        callback(null, folderTree);
      });
    }
  });
}

module.exports = {
  GetFolderTree: getFolderTree,
  GetFileList: getFileList,
};
