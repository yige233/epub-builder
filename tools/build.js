import fs from "fs/promises";
import { createReadStream } from "fs";
import path from "path";
import mime from "mime-types";
import child_proccess from "child_process";
import crypto from "crypto";
/**
 * 复制文件夹，包括子文件夹
 * @param {string} src 源位置
 * @param {string} dest 目标位置
 * @returns
 */
function cpDir(src, dest) {
  return fs.cp(src, dest, { recursive: true });
}
/**
 * 在shell中执行命令，并将输出重定向到控制台。如果stderr有输出，则Promise解析为false
 * @param {child_proccess.SpawnOptionsWithoutStdio} options 选项
 * @returns
 */
function shellExec(options = {}) {
  let OKFlag = true;
  return async (main, ...command) => {
    const proccess = child_proccess.spawn(main, command, Object.assign({ shell: true }, options));
    proccess.stderr.pipe(process.stderr);
    proccess.stdout.pipe(process.stdout);
    return new Promise((resolve) => {
      proccess.on("close", () => resolve(OKFlag));
      proccess.stderr.on("data", () => (OKFlag = false));
    });
  };
}
/**
 * 执行Promise，并等待用户处理可能会产生的错误
 * @param {string} taskName 任务名称
 * @returns
 */
function waitHandleErr(taskName) {
  return async function (promise) {
    const result = await promise;
    process.stdin.setRawMode(true);
    if (result) {
      return result;
    }
    console.log(`执行 ${taskName} 时似乎出现了错误，按下q键退出，按下其他键继续执行：`);
    await new Promise((resolve) =>
      process.stdin.once("data", (key) => {
        if (key.toString().trim() === "q") {
          process.exit(0);
        }
        process.stdin.setRawMode(false);
        resolve();
      })
    );
  };
}
/**
 * 构建文件id列表
 * @param {string} epubDir epub文件夹位置
 * @param {object} assetsPath epub资源路径
 * @returns
 */
async function buildFileIdList(epubDir, assetsPath) {
  /** 额外属性映射表 */
  const additionalPropMap = { "image-cover": "cover-image", "text-cover": "svg", "text-nav": "nav" };
  const fileIdList = [];
  const tasks = Object.entries(assetsPath).map(async ([type, pathVal]) =>
    (async () => {
      const files = await fs.readdir(path.join(epubDir, "OEBPS", pathVal));
      files.forEach((fname) => {
        const id = `${type}-${fname.substring(0, fname.lastIndexOf("."))}`.replace(/\s+/g, "-");
        fileIdList.push({
          id,
          href: `${pathVal}/${fname}`,
          "media-type": mime.lookup(path.extname(fname)),
          properties: additionalPropMap[id],
        });
      });
    })()
  );
  await Promise.allSettled(tasks);
  return fileIdList;
}
/**
 * 根据清单中的元数据和文件id列表构建content.opf
 * @param {object} manifest 清单对象
 * @param {Array} fileIdList 文件id列表
 * @returns
 */
async function buildOPF(manifest, fileIdList) {
  const manifestItemList = fileIdList
    .sort()
    .map((i) =>
      Object.entries(i)
        .filter((i) => i[1])
        .map((i) => `${i[0]}="${i[1]}"`)
        .join(" ")
    )
    .map((i) => `<item ${i}/>`);
  const manifestList = {
    list: [`<item id="ncx" href="ncx/toc.ncx" media-type="application/x-dtbncx+xml"/>`, ...manifestItemList],
    navHref: fileIdList.find((i) => i.id == "text-nav")?.href ?? "",
    coverHref: fileIdList.find((i) => i.id == "text-cover")?.href ?? "",
  };
  return `<?xml version="1.0" encoding="utf-8"?>
<package version="3.0" unique-identifier="${manifest.id}" xmlns="http://www.idpf.org/2007/opf">
  <metadata xmlns:dc="http://purl.org/dc/elements/1.1/"
    xmlns:opf="http://www.idpf.org/2007/opf">
    <dc:language>${manifest.lang}</dc:language>
    <dc:identifier>urn:isbn:${manifest.isbn}</dc:identifier>
    <dc:title id="title">${manifest.title}</dc:title>
    <dc:title id="subtitle">${manifest.subtitle}</dc:title>
    <dc:publisher>${manifest.publisher}</dc:publisher>
    <dc:creator id="cre">${manifest.author}</dc:creator>
    <dc:date>${manifest.date}</dc:date>
    <dc:rights>${manifest.rights}</dc:rights>
    <dc:description>${manifest.desc.join("\n")}</dc:description>
    <dc:identifier id="BookId">urn:uuid:${manifest.id}</dc:identifier>
    <meta refines="#subtitle" property="title-type">subtitle</meta>
    <meta refines="#title" property="title-type">main</meta>
    <meta refines="#cre" property="role" scheme="marc:relators">aut</meta>
    <meta property="ibooks:specified-fonts">true</meta>
    <meta property="dcterms:modified">${new Date().toISOString()}</meta>
    <meta name="git-commit" content="${manifest.gitCommit}"/>
  </metadata>
  <manifest>
    ${manifestList.list.join("\n    ")}
  </manifest>
  <spine toc="ncx">
    ${manifest.toc.map((id) => `<itemref idref="text-${id}"/>`).join("\n    ")}
  </spine>
  <guide>
    <reference type="cover" title="封面" href="${manifestList.coverHref}"/>
    <reference type="toc" title="目录" href="${manifestList.navHref}"/>
  </guide>
</package>`;
}
/**
 * 根据清单中的元数据和nav文件中的a标签构建toc.ncx
 * @param {object} manifest 清单对象
 * @param {string} navHtmlPath nav文件路径
 * @returns
 */
async function buildNCX(manifest, navHtmlPath) {
  const html = await fs.readFile(navHtmlPath, "utf8");
  const navTag = html.match(/<nav epub:type="toc"[^>]*>[\s\S]*?<\/[^>]*nav>/i)?.[0] ?? undefined;
  if (!navTag) {
    throw new Error(`未在 nav 文件中找到正确的 nav 标签：${navHtmlPath}`);
  }
  const anchors = navTag.match(/<a[^>]*>[\s\S]*?<\/[^>]*a>/gi);
  const navPoint = anchors.map((i, index) => {
    const text = i.replace(/<[\s\S]*?>/g, "").replace(/ +/g, " ");
    const href = i.match(/(?<=href=").*?(?=")/i)?.[0] ?? "";
    return `<navPoint id="navPoint${index + 1}"><navLabel><text>${text}</text></navLabel><content src="${href}" /></navPoint>`;
  });
  return `<?xml version="1.0" encoding="utf-8"?>
<ncx xmlns="http://www.daisy.org/z3986/2005/ncx/" version="2005-1">
  <head>
    <meta name="dtb:uid" content="urn:uuid:${manifest.id}" />
    <meta name="dtb:depth" content="1" />
    <meta name="dtb:totalPageCount" content="0" />
    <meta name="dtb:maxPageNumber" content="0" />
  </head>
  <docTitle>
    <text>${manifest.title}</text>
  </docTitle>
  <navMap>
    ${navPoint.join("\n    ")}
  </navMap>
</ncx>`;
}
/**
 * 生成文件信息
 * @param  {...any} filePath 文件路径
 * @returns
 */
async function generateFileInfo(...filePath) {
  function streamHash(filePath) {
    const stream = createReadStream(filePath);
    const hash = crypto.createHash("sha256");
    hash.setEncoding("hex");
    stream.pipe(hash);
    return new Promise((resolve) => {
      stream.on("end", () => {
        hash.end();
        resolve(hash.read());
      });
    });
  }
  const staks = filePath.map((i) =>
    (async () => {
      const stat = await fs.stat(i);
      const hash = await streamHash(i);
      return [path.basename(i), ["    大小(B):", stat.size, "创建时间:", stat.ctime.getTime(), "sha256值:", hash].join(" ")].join("\n");
    })()
  );
  const results = await Promise.allSettled(staks);
  return results.map((i) => i.value);
}
/**
 * 从nav文件中提取a标签，并将其中的占位符替换为可被识别的逻辑目录
 * @param {string} navPath nav文件路径
 * @returns
 */
async function buildTocForNav(navPath) {
  const html = await fs.readFile(navPath, "utf8");
  const placeholder = "${toc}";
  if (html.indexOf(placeholder) < 0) {
    console.warn(`未在 nav 文件中找到目录占位符：${navPath}`);
    return html;
  }
  const anchors = html.match(/<a[^>]*>[\s\S]*?<\/[^>]*a>/gi);
  const li = anchors.map((i) => `<li>${i}</li>`).join("\n");
  return html.replace(placeholder, `<nav epub:type="toc" id="toc" role="doc-toc"><ol>${li}</ol></nav>`);
}

try {
  const [noMobi] = process.argv.slice(2);

  const epubDir = path.join("./build");
  const kindlegenTempDir = path.join("./kindlegen-temp");
  const outputDir = path.join("./dist");
  const epubTemplateDir = path.join("./epub-template");
  const src = path.join("./src");
  const kindlegenDir = path.join("tools/kindlegen/kindlegen");
  const nanaZipdir = path.join("tools/7z/7za");
  const gitCommit = await new Promise((resolve) =>
    child_proccess.exec("git rev-parse HEAD", (error, stdout) => {
      if (error) resolve("none");
      resolve(stdout.trim());
    })
  );

  await fs.rm(epubDir, { recursive: true }).catch(() => undefined);
  await fs.rm(outputDir, { recursive: true }).catch(() => undefined);
  await fs.mkdir(epubDir, { recursive: true });
  await fs.mkdir(kindlegenTempDir, { recursive: true });
  await fs.mkdir(outputDir, { recursive: true });

  console.log("复制epub模板……");
  await cpDir(epubTemplateDir, epubDir);

  console.log("读取元数据文件……");
  const manifest = await fs.readFile(path.join(src, "manifest.json"), "utf8").then(JSON.parse);
  manifest.gitCommit = gitCommit;
  const bookName = manifest.title + " - " + manifest.subtitle;
  const epubFile = path.join(outputDir, bookName + ".epub");
  const mobiFile = path.join(outputDir, bookName + ".mobi");
  const infoFile = path.join(outputDir, "info.txt");

  console.log("复制源文件……");
  await cpDir(path.join(src, manifest.assetsPath.text), path.join(epubDir, "OEBPS", manifest.assetsPath.text));
  await cpDir(path.join(src, manifest.assetsPath.image), path.join(epubDir, "OEBPS", manifest.assetsPath.image));
  await cpDir(path.join(src, manifest.assetsPath.font), path.join(epubDir, "OEBPS", manifest.assetsPath.font));
  await cpDir(path.join(src, manifest.assetsPath.style), path.join(epubDir, "OEBPS", manifest.assetsPath.style));

  console.log("构建nav、content.opf和toc.ncx……");
  const fileIdList = await buildFileIdList(epubDir, manifest.assetsPath);
  const navPath = path.join(epubDir, "OEBPS", fileIdList.find((i) => i.id == "text-nav")?.href);
  const newNav = await buildTocForNav(navPath);
  await fs.writeFile(navPath, newNav);
  const opf = await buildOPF(manifest, fileIdList);
  await fs.writeFile(path.join(epubDir, "OEBPS/content.opf"), opf);
  const ncx = await buildNCX(manifest, navPath);
  await fs.writeFile(path.join(epubDir, "OEBPS/ncx/toc.ncx"), ncx);

  console.log("裁剪字体……");
  await waitHandleErr("裁剪字体")(shellExec()("npx", "font-spider", path.join(epubDir, "OEBPS", manifest.assetsPath.text) + "/*"));
  await fs.rm(path.join(epubDir, "OEBPS", manifest.assetsPath.font, ".font-spider"), { recursive: true, force: true });

  console.log("压缩电子书为epub文件……");
  await waitHandleErr("构建epub文件")(shellExec()(nanaZipdir, "a", `"${epubFile}"`, "./" + epubDir + "/*"));

  if (noMobi !== "no-mobi") {
    console.log("生成mobi格式的电子书文件……");
    await waitHandleErr("转换epub格式为mobi格式")(shellExec()(kindlegenDir, "-tempfolder", kindlegenTempDir, "-c1", "zh", "-dont_append_source", `"${epubFile}"`));
    await fs.rm(kindlegenTempDir, { recursive: true }).catch(() => undefined);
  }

  console.log("生成文件信息……");
  const fileInfo = await generateFileInfo(epubFile, mobiFile);
  await fs.writeFile(infoFile, fileInfo.join("\n\n"));

  console.log("生成的文件信息：", fileInfo.join("\n"));
  console.log("电子书构建完成！");
} catch (e) {
  console.error("构建电子书失败：");
  console.error(e);
}
process.exit(0);
