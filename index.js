// Set Chrome TLS fingerprint for Instagram CDN
try { __gopeed_setFingerprint('chrome'); } catch(e) {}

gopeed.events.onResolve(async function(ctx) {
  var url = ctx.req.url;
  var settings = gopeed.settings || {};

  gopeed.logger.info('[ig-photos] URL: ' + url);

  var shortcode = extractShortcode(url);
  if (!shortcode) {
    throw new Error('Invalid Instagram URL: ' + url);
  }

  gopeed.logger.info('[ig-photos] Shortcode: ' + shortcode);

  var items = [];
  try {
    items = await fetchMedia(url, settings);
  } catch (e) {
    gopeed.logger.error('[ig-photos] Fetch failed: ' + e.message);
    throw e;
  }

  if (items.length === 0) {
    throw new Error('No media found in this post');
  }

  gopeed.logger.info('[ig-photos] Found ' + items.length + ' media items');

  var primaryUser = 'instagram';
  for (var i = 0; i < items.length; i++) {
    if (items[i].username) {
      primaryUser = items[i].username;
      break;
    }
  }

  var files = [];
  for (var i = 0; i < items.length; i++) {
    var item = items[i];
    var username = item.username || primaryUser;
    var suffix = items.length > 1 ? '_' + (i + 1) : '';
    var best = pickBest(item.images);
    if (best && best.url) {
      files.push({
        name: username + '_' + shortcode + suffix + '.jpg',
        req: { url: best.url }
      });
    }
  }

  if (files.length === 0) {
    throw new Error('No downloadable images found in this post');
  }

  gopeed.logger.info('[ig-photos] Returning ' + files.length + ' files');

  ctx.res = {
    name: 'instagram_' + shortcode,
    files: files
  };
});

function extractShortcode(url) {
  var path = url.split('?')[0];
  var m = path.match(/instagram\.com\/(?:[A-Za-z0-9_.]+\/)?(?:p|reel|reels|tv)\/([A-Za-z0-9_-]+)/i);
  return m ? m[1] : null;
}

function pickBest(images) {
  if (!images || images.length === 0) return null;
  var best = images[0];
  for (var i = 1; i < images.length; i++) {
    var bp = (best.width || 0) * (best.height || 0);
    var cp = (images[i].width || 0) * (images[i].height || 0);
    if (cp > bp) best = images[i];
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
    gopeed.logger.info('[ig-photos] Using session cookie');
  }

  // Use referer for Instagram CDN
  headers['referer'] = 'https://www.instagram.com/';

  gopeed.logger.info('[ig-photos] Fetching page...');

  var resp = await fetch(url, { headers: headers });
  if (!resp.ok) {
    throw new Error('Instagram request failed: HTTP ' + resp.status);
  }

  gopeed.logger.info('[ig-photos] Page fetched, reading body...');

  var html = await resp.text();
  gopeed.logger.info('[ig-photos] HTML size: ' + html.length + ' bytes');

  var data = extractData(html);
  if (!data) {
    throw new Error('Could not extract post data. The page may require login.');
  }

  gopeed.logger.info('[ig-photos] Data extracted, searching for images...');

  var result = [];
  findImages(data, result);

  gopeed.logger.info('[ig-photos] Found ' + result.length + ' media items with images');

  return result;
}

function extractData(html) {
  var scripts = [];
  var re = /<script[^>]*>([\s\S]*?)<\/script>/gi;
  var m;
  while ((m = re.exec(html)) !== null) {
    var c = m[1];
    if (c.length > 500 && (c.indexOf('image_versions2') !== -1 || c.indexOf('carousel_media') !== -1)) {
      scripts.push(c);
    }
  }

  if (scripts.length === 0) {
    gopeed.logger.error('[ig-photos] No scripts with image data found');
    return null;
  }

  // Pick the largest script (has the full data)
  scripts.sort(function(a, b) { return b.length - a.length; });
  var best = scripts[0];
  gopeed.logger.info('[ig-photos] Best script size: ' + best.length + ' bytes');

  // Try to navigate Instagram's nested JSON structure
  try {
    var parsed = JSON.parse(best);
    if (parsed.require && parsed.require[0] && parsed.require[0][3]) {
      var items = parsed.require[0][3];
      for (var i = 0; i < items.length; i++) {
        if (items[i] && items[i].__bbox) {
          var bbox = items[i].__bbox;

          // Direct data path (most common for logged-in users)
          if (bbox.result && bbox.result.data) {
            gopeed.logger.info('[ig-photos] Found data via bbox.result.data');
            return bbox.result;
          }

          // Through RelayPrefetchedStreamCache (common for public pages)
          if (bbox.require) {
            for (var j = 0; j < bbox.require.length; j++) {
              var r = bbox.require[j];
              if (Array.isArray(r) && r[0] === 'RelayPrefetchedStreamCache' && r[3]) {
                gopeed.logger.info('[ig-photos] Found data via RelayPrefetchedStreamCache');
                return r[3];
              }
            }
          }
        }
      }
    }
  } catch (e) {
    gopeed.logger.error('[ig-photos] JSON navigate error: ' + e.message);
  }

  // Fallback: extract raw JSON
  gopeed.logger.info('[ig-photos] Trying raw JSON extraction...');
  var fb = best.indexOf('{');
  var lb = best.lastIndexOf('}');
  if (fb !== -1 && lb > fb) {
    try {
      var raw = best.substring(fb, lb + 1);
      gopeed.logger.info('[ig-photos] Raw JSON size: ' + raw.length + ' bytes');
      return JSON.parse(raw);
    } catch (e) {
      gopeed.logger.error('[ig-photos] Raw JSON parse failed: ' + e.message);
      return null;
    }
  }

  return null;
}

function findImages(obj, result, inheritedUser) {
  if (!obj || typeof obj !== 'object') return;

  var user = inheritedUser || '';
  if (obj.user && obj.user.username) {
    user = obj.user.username;
  }

  // Carousel media: multiple images in one post
  if (obj.carousel_media && Array.isArray(obj.carousel_media)) {
    for (var i = 0; i < obj.carousel_media.length; i++) {
      var cm = obj.carousel_media[i];
      if (cm.image_versions2 && cm.image_versions2.candidates) {
        result.push({
          username: user,
          images: cm.image_versions2.candidates.map(function(c) {
            return { url: c.url, width: c.width || 0, height: c.height || 0 };
          })
        });
      }
    }
    return;
  }

  // Single image (only if no carousel_media)
  if (obj.image_versions2 && obj.image_versions2.candidates && obj.image_versions2.candidates.length > 0) {
    result.push({
      username: user,
      images: obj.image_versions2.candidates.map(function(c) {
        return { url: c.url, width: c.width || 0, height: c.height || 0 };
      })
    });
    return;
  }

  // Recurse into arrays
  if (Array.isArray(obj)) {
    for (var i = 0; i < obj.length; i++) {
      findImages(obj[i], result, user);
    }
    return;
  }

  // Recurse into object keys
  var keys = Object.keys(obj);
  for (var i = 0; i < keys.length; i++) {
    var key = keys[i];
    if (key === '__typename' || key === 'config' || key === 'display_url') continue;
    var val = obj[key];
    if (Array.isArray(val) && val.length > 200) continue;
    findImages(val, result, user);
  }
}
