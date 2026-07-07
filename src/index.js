import * as parser from './parser/parse.js';

gopeed.events.onResolve(async (ctx) => {
  const url = ctx.req.url;
  const settings = gopeed.settings;

  const shortcode = parser.extractShortcode(url);
  if (!shortcode) {
    throw new Error('Invalid Instagram URL. Could not extract shortcode.');
  }

  const mediaItems = await parser.fetchPostData(url, settings);
  const files = [];

  for (let i = 0; i < mediaItems.length; i++) {
    const item = mediaItems[i];
    const username = item.username || 'instagram';
    const suffix = mediaItems.length > 1 ? `_${i + 1}` : '';

    // Download images if available
    if (item.images && item.images.length > 0) {
      const bestImage = parser.getBestImage(item.images);
      if (bestImage) {
        files.push({
          name: `${username}_${shortcode}${suffix}.jpg`,
          req: {
            url: bestImage.url,
          },
        });
      }
    }

    // Also download video if this is a video post (for mixed carousels)
    // Photos extension only: skip videos by default
  }

  if (files.length === 0) {
    throw new Error('No downloadable images found in this post');
  }

  ctx.res = {
    name: `instagram_${shortcode}`,
    files: files,
  };
});
