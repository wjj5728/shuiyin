import { zip } from "fflate";

/**
 * @param {string} name
 * @param {Set<string>} usedNames
 */
function getUniqueFileName(name, usedNames) {
  if (!usedNames.has(name)) {
    usedNames.add(name);
    return name;
  }

  const dotIndex = name.lastIndexOf(".");
  const baseName = dotIndex > 0 ? name.slice(0, dotIndex) : name;
  const extension = dotIndex > 0 ? name.slice(dotIndex) : "";
  let index = 2;
  while (usedNames.has(`${baseName}-${index}${extension}`)) index += 1;
  const uniqueName = `${baseName}-${index}${extension}`;
  usedNames.add(uniqueName);
  return uniqueName;
}

/**
 * Packages already-compressed image blobs without recompressing their contents.
 * @param {Array<{ name: string; blob: Blob }>} files
 * @returns {Promise<Blob>}
 */
export async function createZipBlob(files) {
  /** @type {Record<string, Uint8Array>} */
  const entries = {};
  const usedNames = new Set();
  for (const file of files) {
    const name = getUniqueFileName(file.name, usedNames);
    entries[name] = new Uint8Array(await file.blob.arrayBuffer());
  }

  return new Promise((resolve, reject) => {
    zip(entries, { level: 0 }, (error, archive) => {
      if (error) {
        reject(error);
        return;
      }
      resolve(new Blob([archive], { type: "application/zip" }));
    });
  });
}

/** @param {Date} [date] */
export function getZipFileName(date = new Date()) {
  const pad = (value) => String(value).padStart(2, "0");
  const stamp = `${date.getFullYear()}${pad(date.getMonth() + 1)}${pad(date.getDate())}-${pad(date.getHours())}${pad(date.getMinutes())}`;
  return `picmark-export-${stamp}.zip`;
}
