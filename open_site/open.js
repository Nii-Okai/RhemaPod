(function (root) {
  "use strict";

  var PATH_RE = /^\/(sermon|series|playlist)\/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})\/?$/i;

  /** rhemapod://<type>/<uuid> for a valid share path, otherwise null. Pure; never touches the DOM. */
  function appUrlForPath(pathname) {
    var m = PATH_RE.exec(pathname);
    return m ? "rhemapod://" + m[1].toLowerCase() + "/" + m[2].toLowerCase() : null;
  }

  /** "ios" | "android" | "other". maxTouchPoints catches iPadOS, which reports a Mac UA. */
  function detectPlatform(ua, maxTouchPoints) {
    ua = ua || "";
    if (/iPhone|iPad|iPod/.test(ua)) return "ios";
    if (/Macintosh/.test(ua) && (maxTouchPoints || 0) > 1) return "ios";
    if (/Android/.test(ua)) return "android";
    return "other";
  }

  function init(doc, loc, nav) {
    var button = doc.getElementById("open-app");
    var ios = doc.getElementById("badge-ios");
    var android = doc.getElementById("badge-android");
    var hint = doc.getElementById("phone-hint");

    var url = appUrlForPath(loc.pathname);
    if (button) {
      if (url) {
        button.setAttribute("href", url);
        button.hidden = false;
      } else {
        button.hidden = true;
      }
    }

    var platform = detectPlatform(nav.userAgent, nav.maxTouchPoints);
    if (platform === "ios") {
      if (android) android.hidden = true;
    } else if (platform === "android") {
      if (ios) ios.hidden = true;
    } else if (hint) {
      hint.hidden = false;
    }
  }

  var api = { appUrlForPath: appUrlForPath, detectPlatform: detectPlatform, init: init };
  if (typeof module !== "undefined" && module.exports) {
    module.exports = api;
  } else {
    init(root.document, root.location, root.navigator);
  }
})(typeof window !== "undefined" ? window : this);
