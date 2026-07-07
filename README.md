# Instagram Photo Downloader - Gopeed Extension

A [Gopeed](https://github.com/GopeedLab/gopeed) extension for downloading **photos** from Instagram posts.

Based on [muzzii255/gopeed-extension-instagram](https://github.com/muzzii255/gopeed-extension-instagram) (reel video downloader), adapted to download images from `/p/` posts.

## Features

- Download single-photo Instagram posts
- Download all photos from multi-image (carousel) posts
 image resolution
- Supports proxy configuration (HTTP/SOCKS5)
- Handles posts with mixed image/video carousels (images only)

## Usage

### Supported URLs

```
https://www.instagram.com/p/DZ5OA5ljPEd/
https://instagram.com/p/DZ5OA5ljPEd/
https://www.instagram.com/p/DZ5OA5ljPEd/?img_index=1
```

### Installation

1. Open Gopeed → Extensions page
2. Click Install and enter the repository URL:
   ```
   https://github.com/MAX208V/gopeed-extension-instagram-photos
   ```
3. The extension will be downloaded and activated automatically

### Settings

| Setting ||
 Type / SOC| |name| Proxy| Us Authentication ( |
 | ( |

 from


 clonegithubMAX-agram-photos
npm install
npm run build
```

## How It Works

1. When you add a task with an Instagram `/p/` URL, Gopeed triggers the extension
2. The extension fetches the Instagram page with mobile Safari headers
3. Extracts embedded JSON data from the HTML
4. Finds all image URLs with their resolutions
5. Returns the highest-quality images as downloadable files

## License

ISC
