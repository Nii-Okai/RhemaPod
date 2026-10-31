(function (root) {
  "use strict";

  var PATH_RE = /^\/(sermon|series|playlist)\/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})\/?$/i;

  var CONTEXT_NOUN = { sermon: "a sermon", series: "a series", playlist: "a playlist" };

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
    var lead = doc.getElementById("get-lead");
    var context = doc.getElementById("share-context");

    var url = appUrlForPath(loc.pathname);
    var platform = detectPlatform(nav.userAgent, nav.maxTouchPoints);
    var mobile = platform === "ios" || platform === "android";

    if (url && mobile) {
      var noun = CONTEXT_NOUN[/^rhemapod:\/\/([a-z]+)\//.exec(url)[1]];
      if (context) {
        context.textContent = "Someone shared " + noun + " with you.";
        context.hidden = false;
      }
      if (button) {
        button.setAttribute("href", url);
        button.hidden = false;
      }
      if (lead) lead.textContent = "Don't have the app yet? Get RhemaPod:";
    } else if (button) {
      button.hidden = true;
    }

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
