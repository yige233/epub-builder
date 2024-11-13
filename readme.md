# EPUB 电子书 工具链

一套简单的基于 nodejs 的电子书构建工具，用于从 XHTML 文档构建 Epub。

- 由用户手动执行打包，避免在编辑体积较大的 epub 时，保存会花费较长时间的问题。
- css 和 html 内容完全由使用者控制，可以用你最喜欢的编辑器编辑。
- 打包时，使用的字体会先通过 font-spider 裁剪，减小最终的字体体积。
- 自动构建`toc.ncx`和`content.opf`。

## 使用

所需环境：[Node.js](https://nodejs.org/)；

1. 安装依赖：`npm install`
2. 下载 [7z](https://www.7-zip.org/download.html)，并确保能够在`tools/7z`下找到`7za`可执行文件。
3. 可选的，下载 `kindlegen`，以构建 mobi 格式的电子书：[Kindle 实用工具 – 书伴](https://bookfere.com/tools#KindleGen)，并确保能够在`tools/kindlegen`下找到`kindlegen`可执行文件。
4. 可选的，下载[simple http server](https://github.com/projectdiscovery/simplehttpserver)，并确保在`tools`下找到`simplehttpserver`可执行文件。
   - 通过浏览器实时预览电子书：`npm run preview [?host] [?port]`。预览的样式仅供参考。
5. 构建电子书：`npm run build [?no-mobi]`
   - 使用`npm run build no-mobi`，可不构建 mobi。

## manifest.json

在`src`下定义了一个`manifest.json`文件，用来存储电子书的元数据，如标题、作者、封面、简介、阅读顺序等。比较重要的属性将在下方进行额外说明。

- `id`：电子书的唯一标识符。可以使用 ISBN，也可以去生成一个随机 uuid。
- `assetsPath`：电子书资源的路径。其下有四个属性，分别对应文本、图片、字体和样式。epub 构建程序会自动将这些资源打包到电子书中。所有的文件都建议使用英文文件名。
  - `text`：文本资源，如`.xhtml`文件。**必须要包含一个`nav`（忽略扩展名，下同）文件**，以从中构建目录；**必须要包含一个`cover`文件**，以从将其作为 html 封面。
  - `image`：图片资源。**必须要包含一个`cover`文件**，以作为图片封面。
  - `font`：字体资源。建议仅使用 ttf 格式字体，以保证兼容性。
  - `style`：样式资源。最终的样式实现以目标阅读器显示的为准。
- `toc`：目录，或者说阅读器按照何种顺序显示`text`中的内容。这是一个数组，其中的每个元素都是`text`中去除了扩展名的文件名。

## nav.xhtml

可以在`nav`文件中使用一个目录占位符`${toc}`，该占位符用于向`nav`中插入逻辑目录，该目录从`nav`中的`<a>`标签中获取。使用者可专注于目录的显示效果。

## conver.xhtml

该文档中的`<image>`标签的`height`和`width`属性，需要根据实际的图片大小来设置。
