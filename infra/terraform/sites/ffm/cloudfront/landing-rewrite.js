// CloudFront viewer-request function for ffm.derschweigert.de (runtime: cloudfront-js-2.0).
//
// Why this exists:
// - The S3 origin is a plain bucket with no directory-index support and no
//   403/404 rewrite: /play, /promo/ and /beta/ all return 403 without a
//   function like this one. CloudFront's default_root_object only covers the
//   bare "/" request.
// - The game shell must stay at sites/ffm/static/index.html because the
//   Capacitor bundler (sites/ffm/mobile/scripts/copy-assets.mjs) and six
//   mobile test files depend on that exact path, so pretty URLs need a
//   rewrite rather than a file move.
//
// Rewritten requests only change request.uri; query string, method, headers,
// cookies and body pass through unchanged.
//
// URL map:
//   /        -> /promo/index.html  (promotional landing page)
//   /promo   -> /promo/index.html
//   /promo/  -> /promo/index.html
//   /beta    -> /beta/index.html   (open-beta invite page)
//   /beta/   -> /beta/index.html
//   /play    -> /index.html        (the game)
//   /play/   -> 301 to /play
//   everything else unchanged (assets, legal pages, /api/*, /unlock*).
//
// /play/ is a redirect, not a rewrite: the game shell loads styles.css,
// game/main.js, favicon.png, ... relative to its own URL, so serving it at
// /play/ would make those requests resolve to /play/... and 403. At /play
// they resolve to the bucket root and work. /promo/ and /beta/ need no
// redirect because those pages reference their assets root-absolutely
// (/promo/..., /beta/...), so the browser URL stays as requested after the
// rewrite.
//
// If this function is ever detached, "/" falls back to CloudFront's
// default_root_object and serves the game again; nothing hard-fails.
function handler(event) {
    var request = event.request;
    var uri = request.uri;

    if (uri === undefined || uri === null || uri === "") {
        uri = "/";
    }

    if (uri === "/" || uri === "/promo" || uri === "/promo/") {
        request.uri = "/promo/index.html";
    } else if (uri === "/beta" || uri === "/beta/") {
        request.uri = "/beta/index.html";
    } else if (uri === "/play") {
        request.uri = "/index.html";
    } else if (uri === "/play/") {
        return {
            statusCode: 301,
            statusDescription: "Moved Permanently",
            headers: {
                location: { value: "/play" },
            },
        };
    }

    return request;
}
