// Runtime configuration. Overwritten by docker-entrypoint.sh from env vars at
// container start. This default placeholder is used for `npm run dev`/build.
window.__VIEWER_CONFIG__ = {
  GRAMPS_API_URL: "/api",
  GRAMPS_VIEWER_USER: "",
  GRAMPS_VIEWER_PASS: "",
  TITLE: "Family Tree"
};
