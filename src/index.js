try { __gopeed_setFingerprint('chrome'); } catch(e) {}

gopeed.events.onResolve(async function(ctx) {
  var url = ctx.req.url;
  var settings = gopeed.settings || {};

  var shortcode = extractShortcode(url);
  if (!shortcode) {
    throw new Error('Invalid Instagram URL');
  }

  var items = await fetchMedia(url, settings);
  if (items.length === 0) {
    throw new Error('No media found');
  }

  var primaryUser = 'instagram';
  for (var i = 0; i < items.length; i++) {
    if (items[i].username) {
      primaryUser = items[i].username;
      break;
    }
  }

  var files = [];
  var imgIdx = 0;
  var vidIdx = 0;
  for (var i = 0; i < items.length; i++) {
    var item = items[i];
    var username = item.username || primaryUser;
    var titlePart = item.title ? '_' + sanitizeTitle(item.title) : '';
    if (item.images && item.images.length > 0) {
      var best = pickBest(item.images);
      if (best && best.url) {
        imgIdx++;
        var suffix = '_' + pad2(imgIdx);
        files.push({ name: username + '_' + shortcode + titlePart + suffix + '.jpg', req: { url: best.url, headers: { 'Referer': 'https://www.instagram.com/' } } });
      }
    }
    if (item.videos && item.videos.length > 0) {
      var best = pickBest(item.videos);
      if (best && best.url) {
        vidIdx++;
        var suffix = '_' + pad2(vidIdx);
        files.push({ name: username + '_' + shortcode + titlePart + suffix + '.mp4', req: { url: best.url } });
      }
    }
  }
  if (files.length === 1) {
    // Single file: strip the _01 suffix
    files[0].name = files[0].name.replace(/_\d{2}(\.\w+)$/, '$1');
  }

  if (files.length === 0) {
    throw new Error('No downloadable media found');
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
    if ((images[i].width || 0) * (images[i].height || 0) > (best.width || 0) * (best.height || 0)) {
      best = images[i];
    }
  }
  return best;
}

async function fetchMedia(url, settings) {
  var headers = {
    'accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
    'user-agent': 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.5 Mobile/15E148 Safari/604.1',
    'x-ig-app-id': '936619743392459',
    'referer': 'https://www.instagram.com/'
  };
  if (settings.cookie) {
    headers['cookie'] = settings.cookie;
  }

  var resp = await fetch(url, { headers: headers });
  if (!resp.ok) {
    throw new Error('HTTP ' + resp.status);
  }

  var html = await resp.text();
  var data = extractData(html);
  if (!data) {
    throw new Error('No post data found. Login required?');
  }

  var result = [];
  findMedia(data, result);
  return result;
}

function extractData(html) {
  var scripts = [];
  var re = /<script[^>]*>([\s\S]*?)<\/script>/gi;
  var m;
  while ((m = re.exec(html)) !== null) {
    var c = m[1];
    if (c.length > 500 && (c.indexOf('image_versions2') !== -1 || c.indexOf('carousel_media') !== -1 || c.indexOf('video_versions') !== -1)) {
      scripts.push(c);
    }
  }
  if (scripts.length === 0) return null;

  scripts.sort(function(a, b) { return b.length - a.length; });
  var best = scripts[0];

  try {
    var parsed = JSON.parse(best);
    if (parsed.require && parsed.require[0] && parsed.require[0][3]) {
      var items = parsed.require[0][3];
      for (var i = 0; i < items.length; i++) {
        if (items[i] && items[i].__bbox) {
          var bbox = items[i].__bbox;
          if (bbox.result && bbox.result.data) return bbox.result;
          if (bbox.require) {
            for (var j = 0; j < bbox.require.length; j++) {
              var r = bbox.require[j];
              if (Array.isArray(r) && r[0] === 'RelayPrefetchedStreamCache' && r[3]) return r[3];
            }
          }
        }
      }
    }
  } catch(e) {}

  var fb = best.indexOf('{');
  var lb = best.lastIndexOf('}');
  if (fb !== -1 && lb > fb) {
    try { return JSON.parse(best.substring(fb, lb + 1)); } catch(e) {}
  }
  return null;
}

function findMedia(obj, result, inheritedUser) {
  if (!obj || typeof obj !== 'object') return;
  var user = inheritedUser || '';
  if (obj.user && obj.user.username) user = obj.user.username;

  // Capture caption from post
  var caption = '';
  if (obj.caption && obj.caption.text) caption = obj.caption.text;

  // Priority 1: Carousel (multiple images/videos) — must be checked BEFORE
  // single image/video, because carousel posts also have image_versions2
  // at the parent level as a cover thumbnail, which would shadow carousel_media.
  // Also support GraphQL edge_sidecar_to_children format.
  var carousel = null;
  if (obj.carousel_media && Array.isArray(obj.carousel_media)) {
    carousel = obj.carousel_media;
  } else if (obj.edge_sidecar_to_children && Array.isArray(obj.edge_sidecar_to_children.edges)) {
    carousel = [];
    for (var i = 0; i < obj.edge_sidecar_to_children.edges.length; i++) {
      var e = obj.edge_sidecar_to_children.edges[i];
      if (e && e.node) carousel.push(e.node);
    }
  }
  if (carousel) {
    for (var i = 0; i < carousel.length; i++) {
      var cm = carousel[i];
      var entry = { username: user, title: caption, images: [], videos: [] };
      if (cm.video_versions && Array.isArray(cm.video_versions)) {
        entry.videos = mapVersions(cm.video_versions);
      }
      if (cm.image_versions2 && cm.image_versions2.candidates) {
        entry.images = mapCandidates(cm.image_versions2.candidates);
      }
      // GraphQL: display_resources / display_url fallback
      if (entry.images.length === 0 && entry.videos.length === 0) {
        if (cm.display_resources && Array.isArray(cm.display_resources)) {
          entry.images = cm.display_resources.map(function(r) {
            return { url: r.src || r.url, width: r.config_width || 0, height: r.config_height || 0 };
          });
        } else if (cm.display_url) {
          entry.images = [{ url: cm.display_url, width: 0, height: 0 }];
        }
      }
      if (entry.images.length > 0 || entry.videos.length > 0) {
        result.push(entry);
      }
    }
    return;
  }

  // Priority 2: Single video (only when not part of a carousel)
  if (obj.video_versions && Array.isArray(obj.video_versions)) {
    var entry = { username: user, title: caption, images: [], videos: mapVersions(obj.video_versions) };
    if (obj.image_versions2 && obj.image_versions2.candidates) {
      entry.images = mapCandidates(obj.image_versions2.candidates);
    }
    if (!entry.title) entry.title = caption;
    result.push(entry);
    return;
  }

  // Priority 3: Single image (lowest priority — carousel/video already handled)
  if (obj.image_versions2 && obj.image_versions2.candidates && obj.image_versions2.candidates.length > 0) {
    result.push({ username: user, title: caption, images: mapCandidates(obj.image_versions2.candidates), videos: [] });
    return;
  }

  if (Array.isArray(obj)) {
    for (var i = 0; i < obj.length; i++) findMedia(obj[i], result, user);
  } else {
    var keys = Object.keys(obj);
    for (var i = 0; i < keys.length; i++) {
      var key = keys[i];
      if (key === '__typename' || key === 'config' || key === 'display_url') continue;
      var val = obj[key];
      if (Array.isArray(val) && val.length > 200) continue;
      findMedia(val, result, user);
    }
  }
}

function mapCandidates(candidates) {
  var result = [];
  for (var i = 0; i < candidates.length; i++) {
    result.push({ url: candidates[i].url, width: candidates[i].width || 0, height: candidates[i].height || 0 });
  }
  return result;
}

function sanitizeTitle(text) {
  if (!text) return '';
  var t = text.replace(/[\\/:*?"<>|]/g, '').replace(/\s+/g, '_').replace(/_+/g, '_').replace(/^_|_$/g, '');
  if (t.length > 50) t = t.substring(0, 50).replace(/_+[^_]*$/, '');
  return t;
}

function mapVersions(versions) {
  var result = [];
  for (var i = 0; i < versions.length; i++) {
    result.push({ url: versions[i].url, width: versions[i].width || 0, height: versions[i].height || 0 });
  }
  return result;
}

function pad2(n) {
  return n < 10 ? '0' + n : '' + n;
}
