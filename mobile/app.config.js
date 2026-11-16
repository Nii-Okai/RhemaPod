// Extends app.json with values that must not live in the (public) repo.
//
// GOOGLE_SERVICES_JSON is an EAS environment variable of type "file" (secret):
// EAS writes the uploaded google-services.json to disk during the build and puts
// its path here. Android push notifications need it; without it (local dev, CI)
// the build simply has no Firebase config.
module.exports = ({ config }) => {
  const googleServicesFile = process.env.GOOGLE_SERVICES_JSON;
  if (!googleServicesFile) return config;
  return {
    ...config,
    android: { ...config.android, googleServicesFile },
  };
};
