#!/usr/bin/env bash
# Deploys RhemaPod's Azure infrastructure. Run from anywhere, signed in with
# `az login` as someone who can create resources and role assignments (Owner)
# on the target subscription. DEPLOYMENT-AZURE.md walks through the order.
#
#   infra/azure/deploy.sh shared                 # container registry (once)
#   infra/azure/deploy.sh platform nonprod|prod  # Container Apps env, Postgres, Redis
#   infra/azure/deploy.sh app dev|test|prod [--image-tag <sha>]
#
# Environment:
#   AZURE_ACR_NAME          registry name, e.g. rhemapodacr (required)
#   AZURE_LOCATION          default germanywestcentral
#   BUDGET_ALERT_EMAILS     comma-separated, for the platform budget alerts
#   AZURE_ACR_RESOURCE_GROUP, AZURE_ACR_SUBSCRIPTION_ID
#                           only if the registry is not in rg-rhemapod-shared
#                           of the current subscription
#
# Safe to re-run. Generated passwords are read back from Key Vault, never
# regenerated; `app` keeps the image that is already running unless you pass
# --image-tag, so an infrastructure change never rolls the code back.
set -euo pipefail

missing=()

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
export AZURE_LOCATION="${AZURE_LOCATION:-germanywestcentral}"

die() { echo "error: $*" >&2; exit 1; }
need() { command -v "$1" >/dev/null || die "$1 is not installed"; }
need az
need jq
need openssl

[[ -n "${AZURE_ACR_NAME:-}" ]] || die "set AZURE_ACR_NAME (see DEPLOYMENT-AZURE.md §2)"
export AZURE_ACR_NAME
export AZURE_ACR_RESOURCE_GROUP="${AZURE_ACR_RESOURCE_GROUP:-rg-rhemapod-shared}"
export AZURE_ACR_SUBSCRIPTION_ID="${AZURE_ACR_SUBSCRIPTION_ID:-$(az account show --query id -o tsv)}"
export BUDGET_ALERT_EMAILS="${BUDGET_ALERT_EMAILS:-}"
export DEPLOYER_OBJECT_ID
DEPLOYER_OBJECT_ID="$(az ad signed-in-user show --query id -o tsv)"

stamp() { date -u +%Y%m%d-%H%M%S; }

# Reads a secret, distinguishing "not there yet" (prints nothing) from "can't
# read it" (aborts), so a permissions delay never causes a password reset.
read_secret() {
  local vault="$1" name="$2" out
  if out="$(az keyvault secret show --vault-name "$vault" --name "$name" --query value -o tsv 2>&1)"; then
    printf '%s' "$out"
  elif grep -q 'SecretNotFound' <<<"$out"; then
    printf ''
  else
    die "can't read $name from $vault (new role assignments take a few minutes; retry): $out"
  fi
}

# Fills the global `missing` with the API secrets not yet set in the vault.
missing_secrets() {
  local vault="$1" params="$2" built name
  missing=()
  built="$(mktemp)"
  DEPLOY_APPS=false IMAGE_TAG="" az bicep build-params --file "$params" --outfile "$built" >/dev/null
  while read -r name; do
    [[ -n "$(read_secret "$vault" "$name")" ]] || missing+=("$name")
  done < <(jq -r '.parameters.apiSecretNames.value[]' "$built")
  rm -f "$built"
}

# Creates the resource group only if it's missing. An existing group keeps its
# region; the resources in it follow AZURE_LOCATION, which Azure allows.
ensure_group() {
  if [[ "$(az group exists -n "$1")" != true ]]; then
    az group create -n "$1" -l "$AZURE_LOCATION" -o none
  fi
}

deploy_shared() {
  local rg="$AZURE_ACR_RESOURCE_GROUP"
  ensure_group "$rg"
  az deployment group create -g "$rg" -n "shared-$(stamp)" \
    -f "$HERE/shared.bicep" -p acrName="$AZURE_ACR_NAME" \
    --query properties.outputs -o json
}

deploy_platform() {
  local platform="$1" rg="rg-rhemapod-$1" params vault
  case "$platform" in
    nonprod) params="$HERE/params/nonprod.bicepparam" ;;
    prod) params="$HERE/params/prod-platform.bicepparam" ;;
    *) die "platform must be nonprod or prod" ;;
  esac
  ensure_group "$rg"
  vault="$(az keyvault list -g "$rg" \
    --query "[?starts_with(name, 'kv-rp-$platform-') && !contains(name, '-app-')].name | [0]" -o tsv)"

  POSTGRES_ADMIN_PASSWORD=""
  REDIS_PASSWORD=""
  if [[ -n "$vault" ]]; then
    POSTGRES_ADMIN_PASSWORD="$(read_secret "$vault" postgres-admin-password)"
    [[ "$platform" == nonprod ]] && REDIS_PASSWORD="$(read_secret "$vault" redis-password)"
  fi
  # Hex: no characters that need escaping inside a connection URL.
  [[ -n "$POSTGRES_ADMIN_PASSWORD" ]] || POSTGRES_ADMIN_PASSWORD="$(openssl rand -hex 24)"
  [[ "$platform" == nonprod && -z "$REDIS_PASSWORD" ]] && REDIS_PASSWORD="$(openssl rand -hex 24)"
  export POSTGRES_ADMIN_PASSWORD REDIS_PASSWORD

  az deployment group create -g "$rg" -n "platform-$(stamp)" \
    -f "$HERE/platform.bicep" -p "$params" \
    --query properties.outputs -o json
}

deploy_app() {
  local env="$1" platform rg api current params vault
  shift
  case "$env" in
    dev | test) platform=nonprod ;;
    prod) platform=prod ;;
    *) die "environment must be dev, test or prod" ;;
  esac
  rg="rg-rhemapod-$platform"
  params="$HERE/params/$env.bicepparam"

  IMAGE_TAG=""
  while [[ $# -gt 0 ]]; do
    case "$1" in
      --image-tag) IMAGE_TAG="$2"; shift 2 ;;
      *) die "unknown option $1" ;;
    esac
  done
  api="rhemapod-$env-api"
  if [[ -z "$IMAGE_TAG" ]]; then
    current="$(az containerapp show -g "$rg" -n "$api" \
      --query 'properties.template.containers[0].image' -o tsv 2>/dev/null || true)"
    IMAGE_TAG="${current##*:}"
  fi
  export IMAGE_TAG

  # Apps only once every secret they reference exists: a container app that
  # points at a missing Key Vault secret fails to provision.
  vault="$(az keyvault list -g "$rg" --query "[?starts_with(name, 'kv-rp-$env-app-')].name | [0]" -o tsv)"
  DEPLOY_APPS=false
  if [[ -n "$vault" && -n "$IMAGE_TAG" ]]; then
    missing_secrets "$vault" "$params"
    [[ ${#missing[@]} -eq 0 ]] && DEPLOY_APPS=true
  fi
  export DEPLOY_APPS

  echo "deploying $env (apps: $DEPLOY_APPS, image: ${IMAGE_TAG:-none yet})"
  az deployment group create -g "$rg" -n "app-$env-$(stamp)" \
    -f "$HERE/main.bicep" -p "$params" \
    --query properties.outputs -o json

  vault="$(az keyvault list -g "$rg" --query "[?starts_with(name, 'kv-rp-$env-app-')].name | [0]" -o tsv)"
  # SECRET_KEY is generated once per environment and never shared with another.
  if [[ -z "$(read_secret "$vault" secret-key)" ]]; then
    az keyvault secret set --vault-name "$vault" --name secret-key \
      --value "$(openssl rand -base64 48 | tr -d '\n')" -o none
    echo "generated secret-key in $vault"
  fi

  if [[ "$DEPLOY_APPS" == false ]]; then
    echo
    if [[ -z "$IMAGE_TAG" ]]; then
      echo "No image yet: run the 'Deploy to Azure' workflow once to build one,"
      echo "then: infra/azure/deploy.sh app $env --image-tag <commit sha>"
    fi
    missing_secrets "$vault" "$params"
    if [[ ${#missing[@]} -gt 0 ]]; then
      echo "Set these secrets in $vault, then re-run (DEPLOYMENT-AZURE.md §4):"
      printf '  %s\n' "${missing[@]}"
    fi
  fi
}

case "${1:-}" in
  shared) deploy_shared ;;
  platform) [[ $# -eq 2 ]] || die "usage: deploy.sh platform nonprod|prod"; deploy_platform "$2" ;;
  app) [[ $# -ge 2 ]] || die "usage: deploy.sh app dev|test|prod [--image-tag <sha>]"; shift; deploy_app "$@" ;;
  *) sed -n '2,20p' "${BASH_SOURCE[0]}"; exit 1 ;;
esac
