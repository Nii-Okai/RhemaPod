// Shared layer: the container registry every environment pulls from
// (rg-rhemapod-shared). Images are built once per commit and tagged with the
// commit SHA: rhemapod-api:<sha>, rhemapod-admin:<sha>.
//
// Deploy with infra/azure/deploy.sh shared (DEPLOYMENT-AZURE.md).

param location string = resourceGroup().location

@description('Globally unique, 5-50 lowercase letters and digits.')
param acrName string

param tags object = {}

resource acr 'Microsoft.ContainerRegistry/registries@2023-07-01' = {
  name: acrName
  location: location
  tags: union(tags, { app: 'rhemapod' })
  sku: { name: 'Basic' }
  properties: {
    adminUserEnabled: false
    anonymousPullEnabled: false
  }
}

output loginServer string = acr.properties.loginServer
