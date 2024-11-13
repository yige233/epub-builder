import child_process from "child_process";

const [host = "localhost", port = 8880] = process.argv.slice(2);

console.log(`在浏览器中打开目录地址：http://${host}:${port}/Text/nav.xhtml`);
console.log(`注意：浏览器显示的样式不能代表最终电子书的样式，特别是在Kindle的样式，建议配合构建工具使用。`);
const child = child_process.spawn("tools/simplehttpserver", ["-listen", `${host}:${port}`, "-path", "src/"]);
child.stdout.pipe(process.stdout);
child.stderr.pipe(process.stderr);
