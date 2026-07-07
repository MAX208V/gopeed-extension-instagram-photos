gopeed.events.onResolve(async function(ctx) {
  var url = ctx.req.url;
  var settings = gopeed.settings || {};

  var shortcode = extractShortcode(url);
  if (!shortcode) {
    throw new Error('Invalid Instagram URL');
  }

  var items = await fetchMedia(url, settings);
  if (items.length === 0) {
    throw new Error('No media found in this post');
  }

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
  }

  var resp = await fetch(url, { headers: headers });
  if (!resp.ok) {
    throw new Error('Instagram request failed: HTTP ' + resp.status);
  }

  var html = await resp.text();
  var data = extractData(html);
  if (!data) {
    throw new Error('Could not extract post data. The page may require login.');
  }

  var result = [];
  findImages(data, result);
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
  if (scripts.length === 0) return null;

  // Pick the largest script (has the full data)
  scripts.sort(function(a, b) { return b.length - a.length; });
  var best = scripts[0];

  // Try to navigate Instagram's nested JSON structure
  try {
    var parsed = JSON.parse(best);
    if (parsed.require && parsed.require[0] && parsed.require[0][3]) {
      var items = parsed.require[0][3];
      for (var i = 0; i < items.length; i++) {
        if (items[i] && items[i].__bbox) {
          var bbox = items[i].__bbox;
          if (bbox.result && bbox.result.data) {
            return bbox.result;
          }
          if (bbox.require) {
            for (var j = 0; j < bbox.require.length; j++) {
              var r = bbox.require[j];
              if (Array.isArray(r) && r[0] === 'RelayPrefetchedStreamCache' && r[3]) {
                return r[3];
              }
            }
          }
        }
      }
    }
  } catch (e) {
    // Fall through
  }

  // Fallback: extract raw JSON
  var fb = best.indexOf('{');
  var lb = best.lastIndexOf('}');
  if (fb !== -1 && lb > fb) {
    try {
      return JSON.parse(best.substring(fb, lb + 1));
    } catch (e) {
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

  // Single image
  if (obj.image_versions2 && obj.image_versions2.candidates && obj.image_versions2.candidates.length > 0) {
    result.push({
      username: user,
      images: obj.image_versions2.candidates.map(function(c) {
        return { url: c.url, width: c.width || 0, height: c.height || 0 };
      })
    });
    return;
  }

  // Recurse
  if (Array.isArray(obj)) {
    for (var i = 0; i < obj.length; i++) {
      findImages(obj[i], result, user);
    }
  } else {
    var keys = Object.keys(obj);
    for (var i = 0; i < keys.length; i++) {
      var key = keys[i];
      if (key === '__typename' || key === 'config' || key === 'display_url') continue;
      var val = obj[key];
      if (Array.isArray(val) && val.length > 200) continue;
      findImages(val, result, user);
    }
  }
}
