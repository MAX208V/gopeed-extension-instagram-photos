gopeed.events.onResolve(async function (ctx) {
  var url = ctx.req.url;
  var settings = gopeed.settings || {};

  // 1. Extract shortcode from URL
  var shortcode = extractShortcode(url);
  if (!shortcode) {
    throw new Error('Invalid Instagram URL');
  }

  // 2. Fetch post page and parse media
  var mediaItems = await fetchMedia(url, settings);

  // 3. Build file list
  var files = [];
  var primaryUser = 'instagram';
  for (var i = 0; i < mediaItems.length; i++) {
    if (mediaItems[i].username) {
      primaryUser = mediaItems[i].username;
      break;
    }
  }

  for (var i = 0; i < mediaItems.length; i++) {
    var item = mediaItems[i];
    var username = item.username || primaryUser;
    var suffix = mediaItems.length > 1 ? '_' + (i + 1) : '';

    if (item.images && item.images.length > 0) {
      var best = getBestImage(item.images);
      if (best && best.url) {
        files.push({
          name: username + '_' + shortcode + suffix + '.jpg',
          req: {
            url: best.url
          }
        });
      }
    }
  }

  if (files.length === 0) {
    throw new Error('No downloadable images found in this post');
  }

  // 4. Return result
  ctx.res = {
    name: 'instagram_' + shortcode,
    files: files
  };
});

// ---- Helper functions ----

function extractShortcode(url) {
  var cleanUrl = url.split('?')[0];
  var patterns = [
    /instagram\.com\/(?:p|reel|reels|tv)\/([A-Za-z0-9_-]+)/i,
    /instagram\.com\/[A-Za-z0-9_.]+\/(?:p|reel|reels|tv)\/([A-Za-z0-9_-]+)/i,
    /instagr\.am\/(?:p|reel|reels|tv)\/([A-Za-z0-9_-]+)/i
  ];
  for (var i = 0; i < patterns.length; i++) {
    var m = cleanUrl.match(patterns[i]);
    if (m) return m[1];
  }
  return null;
}

function getBestImage(images) {
  if (!images || images.length === 0) return null;
  var best = images[0];
  for (var i = 1; i < images.length; i++) {
    var bestPx = (best.width || 0) * (best.height || 0);
    var curPx = (images[i].width || 0) * (images[i].height || 0);
    if (curPx > bestPx) best = images[i];
  }
  return best;
}

async function fetchMedia(url, settings) {
  var headers = {
    'accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
    'user-agent': 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.5 Mobile/15E148 Safari/604.1',
    'x-ig-app-id': '936619743392459'
  };

  if (settings.cookie) {
    headers['cookie'] = settings.cookie;
  }

  var resp = await fetch(url, { headers: headers });
  if (!resp.ok) {
    throw new Error('Instagram request failed: HTTP ' + resp.status);
  }

  var html = await resp.text();

  // Find the JSON data embedded in the page
  var jsonStr = extractJsonData(html);
  if (!jsonStr) {
    throw new Error('Could not find post data. The page may require login.');
  }

  var data = JSON.parse(jsonStr);
  var items = [];

  // Navigate the nested structure to find media items
  findMediaItems(data, items);

  if (items.length === 0) {
    throw new Error('No media found in post data');
  }

  return items;
}

function extractJsonData(html) {
  // Try different script patterns
  var patterns = [
    // Pattern 1: data-sjs script tags (most common for logged-in)
    { search: 'xdt_api__v1__media__shortcode__web_info', full: true },
    // Pattern 2: ScheduledServerJS with media data
    { search: 'image_versions2', full: false },
    // Pattern 3: carousel_media
    { search: 'carousel_media', full: false }
  ];

  // Find all large script tags and check content
  var scriptRegex = /<script[^>]*>([\s\S]*?)<\/script>/gi;
  var match;
  var candidates = [];

  while ((match = scriptRegex.exec(html)) !== null) {
    var content = match[1];
    if (content.length < 500) continue;
    for (var p = 0; p < patterns.length; p++) {
      if (content.indexOf(patterns[p].search) !== -1) {
        candidates.push({ content: content, len: content.length, pattern: p });
        break;
      }
    }
  }

  // Pick the largest matching script
  if (candidates.length === 0) return null;
  candidates.sort(function (a, b) { return b.len - a.len; });
  var best = candidates[0].content;

  // Try to extract the actual media data from the nested structure
  // Instagram uses: {"require":[["ScheduledServerJS","handle",null,[{"__bbox":{"require":[["RelayPrefetchedStreamCache","next",[],DATA]]}}]]]}
  try {
    var parsed = JSON.parse(best);
    if (parsed.require && parsed.require[0] && parsed.require[0][3]) {
      var bboxItems = parsed.require[0][3];
      for (var i = 0; i < bboxItems.length; i++) {
        if (bboxItems[i] && bboxItems[i].__bbox) {
          var bbox = bboxItems[i].__bbox;
          // Direct data in bbox.result
          if (bbox.result && bbox.result.data) {
            var resultStr = JSON.stringify(bbox.result);
            return resultStr;
          }
          // Or in bbox.require
          if (bbox.require) {
            for (var j = 0; j < bbox.require.length; j++) {
              var req = bbox.require[j];
              if (Array.isArray(req) && req[0] === 'RelayPrefetchedStreamCache' && req[3]) {
                return JSON.stringify(req[3]);
              }
            }
          }
        }
      }
    }
  } catch (e) {
    // Fall through to raw extraction
  }

  // Fallback: extract JSON from the script content directly
  var firstBrace = best.indexOf('{');
  var lastBrace = best.lastIndexOf('}');
  if (firstBrace !== -1 && lastBrace > firstBrace) {
    return best.substring(firstBrace, lastBrace + 1);
  }

  return null;
}

function findMediaItems(obj, result, inheritedUser) {
  if (!obj || typeof obj !== 'object') return;

  // Track username
  var currentUser = inheritedUser || '';
  if (obj.user && obj.user.username) {
    currentUser = obj.user.username;
  }

  // Found a media item with images
  if (obj.image_versions2 && obj.image_versions2.candidates && obj.image_versions2.candidates.length > 0) {
    // Skip if it has carousel_media (processed separately)
    if (!obj.carousel_media) {
      result.push({
        username: currentUser,
        images: obj.image_versions2.candidates.map(function (c) {
          return { url: c.url, width: c.width || 0, height: c.height || 0 };
        })
      });
      return;
    }
  }

  // Handle carousel_media
  if (obj.carousel_media && Array.isArray(obj.carousel_media)) {
    for (var i = 0; i < obj.carousel_media.length; i++) {
      var cm = obj.carousel_media[i];
      if (cm.image_versions2 && cm.image_versions2.candidates) {
        result.push({
          username: currentUser,
          images: cm.image_versions2.candidates.map(function (c) {
            return { url: c.url, width: c.width || 0, height: c.height || 0 };
          })
        });
      }
    }
    return;
  }

  // Recursive search
  if (Array.isArray(obj)) {
    for (var i = 0; i < obj.length; i++) {
      findMediaItems(obj[i], result, currentUser);
    }
  } else {
    var keys = Object.keys(obj);
    for (var i = 0; i < keys.length; i++) {
      var key = keys[i];
      if (key === '__typename' || key === 'config' || key === 'display_url') continue;
      // Skip very long arrays that won't contain media data
      var val = obj[key];
      if (Array.isArray(val) && val.length > 200) continue;
      findMediaItems(val, result, currentUser);
    }
  }
}
