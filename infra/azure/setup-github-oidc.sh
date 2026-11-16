#!/usr/bin/env bash
# Lets the "Deploy to Azure" workflow sign in to Azure without a stored
# password (GitHub OIDC). Run once per platform after deploy.sh has created the
# resource groups (DEPLOYMENT-AZURE.md §5):
#
#   infra/azure/setup-github-oidc.sh nonprod   # trusted by GitHub environments dev, test
#   infra/azure/setup-github-oidc.sh prod      # trusted by GitHub environment production
#
# Creates an Entra app registration "rhemapod-deploy-<platform>", trusts only
# the named GitHub environments of this repository, and gives it Contributor on
# that platform's resource group and on the shared registry. Nothing else: the
# nonprod identity can't touch production.
#
# Environment: AZURE_ACR_NAME (required), AZURE_ACR_RESOURCE_GROUP,
# AZURE_ACR_SUBSCRIPTION_ID, GITHUB_REPO (default Nii-Okai/RhemaPod),
# GITHUB_OIDC_REPO (the repo as GitHub writes it in the token's subject claim).
# This repository's tokens use the owner@id/repo@id form, e.g.
# repo:Nii-Okai@9963683/RhemaPod@1414148858:environment:dev, so that is the
# default; the `azure/login` step prints the "subject claim" if it ever changes.
set -euo pipefail

die() { echo "error: $*" >&2; exit 1; }
[[ $# -eq 1 ]] || die "usage: setup-github-oidc.sh nonprod|prod"
platform="$1"
case "$platform" in
  nonprod) environments=(dev test) ;;
  prod) environments=(production) ;;
  *) die "platform must be nonprod or prod" ;;
esac
[[ -n "${AZURE_ACR_NAME:-}" ]] || die "set AZURE_ACR_NAME"
repo="${GITHUB_REPO:-Nii-Okai/RhemaPod}"
oidc_repo="${GITHUB_OIDC_REPO:-Nii-Okai@9963683/RhemaPod@1414148858}"
acr_rg="${AZURE_ACR_RESOURCE_GROUP:-rg-rhemapod-shared}"
subscription="$(az account show --query id -o tsv)"
tenant="$(az account show --query tenantId -o tsv)"
acr_subscription="${AZURE_ACR_SUBSCRIPTION_ID:-$subscription}"
rg_id="/subscriptions/$subscription/resourceGroups/rg-rhemapod-$platform"
acr_id="$(az acr show -n "$AZURE_ACR_NAME" -g "$acr_rg" --subscription "$acr_subscription" --query id -o tsv)"
name="rhemapod-deploy-$platform"

app_id="$(az ad app list --display-name "$name" --query '[0].appId' -o tsv)"
if [[ -z "$app_id" ]]; then
  app_id="$(az ad app create --display-name "$name" --query appId -o tsv)"
  echo "created app registration $name"
fi
az ad sp show --id "$app_id" -o none 2>/dev/null || az ad sp create --id "$app_id" -o none
sp_id="$(az ad sp show --id "$app_id" --query id -o tsv)"

for environment in "${environments[@]}"; do
  cred="github-$environment"
  verb=create
  if az ad app federated-credential show --id "$app_id" --federated-credential-id "$cred" -o none 2>/dev/null; then
    verb=update
  fi
  # shellcheck disable=SC2046
  az ad app federated-credential "$verb" --id "$app_id" \
    $([[ $verb == update ]] && echo --federated-credential-id "$cred") --parameters "$(cat <<JSON
{
  "name": "$cred",
  "issuer": "https://token.actions.githubusercontent.com",
  "subject": "repo:$oidc_repo:environment:$environment",
  "audiences": ["api://AzureADTokenExchange"]
}
JSON
)" -o none
  echo "trusts $repo environment $environment"
done

for scope in "$rg_id" "$acr_id"; do
  az role assignment create --assignee-object-id "$sp_id" --assignee-principal-type ServicePrincipal \
    --role Contributor --scope "$scope" -o none
done
echo "Contributor on rg-rhemapod-$platform and $AZURE_ACR_NAME"

echo
echo "Set these on each GitHub environment (${environments[*]}):"
for environment in "${environments[@]}"; do
  echo "  gh variable set AZURE_CLIENT_ID --env $environment --body $app_id"
  echo "  gh variable set AZURE_TENANT_ID --env $environment --body $tenant"
  echo "  gh variable set AZURE_SUBSCRIPTION_ID --env $environment --body $subscription"
done
echo "And once, on the repository:"
echo "  gh variable set AZURE_ACR_NAME --body $AZURE_ACR_NAME"
echo "  gh variable set AZURE_ACR_SUBSCRIPTION_ID --body $acr_subscription"
