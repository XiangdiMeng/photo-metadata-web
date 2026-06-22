# 照片元数据网页写入器

这是一个独立的网页版本，保留原来的快捷指令和 a-Shell 脚本不动。

## 功能

- 上传图片并在浏览器本地生成新的 JPEG。
- 选择 iPhone 14 到 iPhone 17 系列模板。
- 写入相机厂商、相机型号、镜头型号、拍摄时间、GPS、ISO、焦距、曝光补偿、光圈、快门。
- `LensModel` 沿用自动版脚本里的显示修正：例如 `主相机 — 24 mm 𝑓1.78`。
- 同时写入 `LensSpecification` 和真实 `FNumber`，底部曝光栏仍由系统数值标签生成。
- 生成结果可下载；在 iPhone Safari 上优先使用“分享保存”进入系统分享面板，再保存到相册。

## 使用

线上 HTTPS 地址：

```text
https://xiangdimeng.github.io/photo-metadata-web/
```

在 iPhone Safari 打开这个地址后，生成图片，再点“分享保存”。如果系统弹出分享面板，选择“存储图像”或保存到“照片”即可。

如果不想照片信息里出现“从 Safari 浏览器保存”，请使用配套桥接快捷指令：

导入链接：

- [`照片元数据网页入口.shortcut`](https://xiangdimeng.github.io/photo-metadata-web/shortcuts/entry.shortcut)
- [`照片元数据网页保存.shortcut`](https://xiangdimeng.github.io/photo-metadata-web/shortcuts/save.shortcut)

1. 运行 `照片元数据网页入口`，选择照片。
2. 网页打开后点 `读快捷指令`。
3. 选择手机型号并点 `生成照片`。
4. 点 `快捷指令保存`。
5. iOS 会跳转到 `照片元数据网页保存`，由快捷指令把结果保存到照片。

直接打开 `index.html` 可以使用。为了测试 iPhone 上的分享能力，建议通过本地服务器访问：

```sh
python3 -m http.server 8000
```

然后打开：

```text
http://127.0.0.1:8000/photo-metadata-web/
```

## 模板边界

网页无法从浏览器直接读取“当前 iPhone 的精确型号、主摄光圈、快门、ISO”。因此这里采用手动选择手机型号的方式，再套用模板。GPS 默认是模板坐标，也可以点“当前位置”让浏览器请求定位权限。

非 JPEG 图片会先通过浏览器 Canvas 转成 JPEG，再写入 EXIF。JPEG 图片会尽量保留原始像素数据，只替换 EXIF APP1 段。

## 验证

```sh
cd photo-metadata-web
npm test
```

测试会构造一个最小 JPEG，写入网页端 EXIF，再读回确认 iPhone 模板、`LensModel`、`LensSpecification`、焦距和光圈字段。
