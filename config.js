var nconf = require.main.require("nconf");
var url = nconf
  .get("url")
  .split("://")
  .pop();
var environment;
var themePath;
var apiUrl;
var wpUrl;
var wpAuthUrl;
var esUrl;
var config = {};

switch (url) {
  case "quest-nodebb.smfclient.com":
    environment = "development";
    break;
  case "forum.questoraclecommunity.org":
    environment = "stag";
    break;
  default:
    environment = "local";
}

switch (environment) {
  case "local":
    apiUrl = "http://quest-api-local.smfclient.com/";
    wpUrl = "http://quest-local.smfclient.com";
    wpAuthUrl = "http://quest-local.smfclient.com";
    themePath = "/app/themes/quest-theme";
    esUrl =
      "https://search-questdirect-dev-5h3xvv7tpxgrd6lyducmz3ahju.us-east-1.es.amazonaws.com";
    break;
  case "development":
    apiUrl = "https://quest-api.smfclient.com/";
    wpUrl = "https://quest-wp.smfclient.com";
    wpAuthUrl = "https://demo:324d785d8c71@quest-wp.smfclient.com";
    themePath = "/wp-content/themes/quest-theme";
    esUrl =
      "https://search-questdirect-dev-5h3xvv7tpxgrd6lyducmz3ahju.us-east-1.es.amazonaws.com";
    break;
  case "stag":
    apiUrl = "https://api.questoraclecommunity.org/";
    wpUrl = "https://questoraclecommunity.org";
    wpAuthUrl = "https://questcommunity:d9532775@questoraclecommunity.org";
    themePath = "/wp-content/themes/quest-theme";
    esUrl =
      "https://search-questdirect-stag-pvvjoirv2t3bexdr3bz3yhr4za.us-east-1.es.amazonaws.com";
    break;
  default:
    apiUrl = "https://quest-api.smfclient.com/";
    wpUrl = "https://quest-wp.smfclient.com";
    wpAuthUrl = "https://demo:324d785d8c71@quest-wp.smfclient.com";
    themePath = "/wp-content/themes/quest-theme";
    esUrl =
      "https://search-questdirect-dev-5h3xvv7tpxgrd6lyducmz3ahju.us-east-1.es.amazonaws.com";
}

config.environment = environment;

config.api = {
  url: apiUrl,
  key: "Aj4GFHTkXeA4ZYF"
};

config.wordpress = {
  url: wpUrl,
  themePath: themePath,
  authUrl: wpAuthUrl,
};

config.stream = {
  key: "mu8xt83vy2bp",
  secret: "dquegn3mk2pbzynnxemgm5nd6h782b9bskm6qhswf4rh4psfja2ev4ggddqjejr4"
};

module.exports = config;
