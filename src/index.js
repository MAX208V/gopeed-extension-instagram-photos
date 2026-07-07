import * as parser from './parser/parse.js';

gopeed.events.onResolve(async (ctx) => {
  const url = ctx.req.url;
  const settings = gopeed.settings;

  const shortcode = parser.extractShortcode(url);
  if (!shortcode) {
    throw new Error('Invalid Instagram URL. Could not extract shortcode.');
  }

  const mediaItems = await parser.fetchPostData(url, settings);

  // Determine the primary username from the first item with a username
  const primaryUsername = mediaItems.find(item => item.username)?.username || 'instagram';

  const files = [];

  for (let i = 0; i < mediaItems.length; i++) {
    const item = mediaItems[i];
    // Use item's own username, fall back to primary username, then 'instagram'
    const username = item.username || primaryUsername;
    const suffix = mediaItems.length > 1 ? `_${i + 1}` : '';

    // Download images if available
    if (item.images && item.images.length > 0) {
      const bestImage = parser.getBestImage(item.images);
      if (bestImage && bestImage.url) {
        files.push({
          name: `${username}_${shortcode}${suffix}.jpg`,
          req: {
            url: bestImage.url,
          },
        });
      }
    }
  }

  if (files.length === 0) {
    // If no images found but there are videos, show a clearer error
    const hasVideos = mediaItems.some(item => item.videos && item.videos.length > 0);
    if (hasVideos) {
      throw new Error('This post contains only videos, no downloadable images found.');
    }
    throw new Error('No downloadable images found in this post.');
  }

  ctx.res = {
    name: `instagram_${shortcode}`,
    files: files,
  };
});
