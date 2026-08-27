const fs = require('fs');
const path = require('path');
const cheerio = require('cheerio');
const AdmZip = require('adm-zip');

/**
 * Downloads a resource and returns it as a Buffer.
 * @param {string} url
 * @returns {Promise<Buffer>}
 */
async function downloadResource(url) {
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`Failed to fetch ${url}: ${response.statusText}`);
  }
  return Buffer.from(await response.arrayBuffer());
}

/**
 * Normalizes and downloads a URL resource, saving it locally.
 * @param {string} resourceUrl
 * @param {string} baseUrl
 * @param {string} outputDir
 * @param {string} subDir
 * @returns {Promise<string|null>} Relative path of the saved resource, or null on failure.
 */
async function saveResource(resourceUrl, baseUrl, outputDir, subDir) {
  try {
    let resolvedUrl = resourceUrl;
    if (!resourceUrl.startsWith('http://') && !resourceUrl.startsWith('https://')) {
      resolvedUrl = new URL(resourceUrl, baseUrl).href;
    }

    const urlObj = new URL(resolvedUrl);
    let filename = path.basename(urlObj.pathname);
    if (!filename || filename.indexOf('.') === -1) {
      filename = 'index' + (subDir === 'js' ? '.js' : subDir === 'css' ? '.css' : '.png');
    }

    // Clean up filename parameters/hashes
    filename = filename.split(/[?#]/)[0];

    // Ensure unique filename
    const targetDir = path.join(outputDir, subDir);
    if (!fs.existsSync(targetDir)) {
      fs.mkdirSync(targetDir, { recursive: true });
    }

    let targetPath = path.join(targetDir, filename);
    let counter = 1;
    const ext = path.extname(filename);
    const base = path.basename(filename, ext);
    while (fs.existsSync(targetPath)) {
      filename = `${base}_${counter}${ext}`;
      targetPath = path.join(targetDir, filename);
      counter++;
    }

    const buffer = await downloadResource(resolvedUrl);
    fs.writeFileSync(targetPath, buffer);

    return `${subDir}/${filename}`;
  } catch (error) {
    console.error(`Error saving resource ${resourceUrl}:`, error.message);
    return null;
  }
}

/**
 * Clones a single-page website, downloading its static assets and packaging them into a ZIP archive.
 * @param {string} siteUrl
 * @param {string} zipName
 * @param {string} tempBaseDir
 * @returns {Promise<string>} Path to the generated ZIP file.
 */
async function cloneWebsite(siteUrl, zipName, tempBaseDir) {
  if (!siteUrl.startsWith('http://') && !siteUrl.startsWith('https://')) {
    siteUrl = 'https://' + siteUrl;
  }

  const cleanZipName = zipName.replace(/[^a-zA-Z0-9-_]/g, '') || 'website';
  const uniqueId = Math.random().toString(36).substring(2, 9);
  const cloneDir = path.join(tempBaseDir, `clone_${uniqueId}`);
  fs.mkdirSync(cloneDir, { recursive: true });

  try {
    const htmlBuffer = await downloadResource(siteUrl);
    const htmlContent = htmlBuffer.toString('utf8');
    const $ = cheerio.load(htmlContent);

    const promises = [];

    // Download styles
    $('link[rel="stylesheet"]').each((i, el) => {
      const href = $(el).attr('href');
      if (href) {
        promises.push(
          saveResource(href, siteUrl, cloneDir, 'css').then((localPath) => {
            if (localPath) $(el).attr('href', localPath);
          })
        );
      }
    });

    // Download scripts
    $('script').each((i, el) => {
      const src = $(el).attr('src');
      if (src) {
        promises.push(
          saveResource(src, siteUrl, cloneDir, 'js').then((localPath) => {
            if (localPath) $(el).attr('src', localPath);
          })
        );
      }
    });

    // Download images
    $('img').each((i, el) => {
      const src = $(el).attr('src');
      if (src) {
        promises.push(
          saveResource(src, siteUrl, cloneDir, 'images').then((localPath) => {
            if (localPath) $(el).attr('src', localPath);
          })
        );
      }
    });

    // Wait for all assets to download
    await Promise.allSettled(promises);

    // Save final HTML file
    fs.writeFileSync(path.join(cloneDir, 'index.html'), $.html(), 'utf8');

    // Create zip
    const zip = new AdmZip();
    zip.addLocalFolder(cloneDir);

    const zipPath = path.join(tempBaseDir, `${cleanZipName}.zip`);
    zip.writeZip(zipPath);

    return zipPath;
  } finally {
    // Cleanup temporary directory
    try {
      fs.rmSync(cloneDir, { recursive: true, force: true });
    } catch (err) {
      console.error('Failed to cleanup temporary clone directory:', err.message);
    }
  }
}

module.exports = {
  cloneWebsite
};
