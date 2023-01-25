import { graphql } from '~~/lib/common/generated/gql'

export const onProjectModelsUpdateSubscription = graphql(`
  subscription OnProjectModelsUpdate($id: String!) {
    projectModelsUpdated(id: $id) {
      id
      type
      model {
        id
        ...ProjectPageLatestItemsModelItem
        ...NewModelVersionMetadata
      }
    }
  }
`)

export const onProjectVersionsUpdateSubscription = graphql(`
  subscription OnProjectVersionsUpdate($id: String!) {
    projectVersionsUpdated(id: $id) {
      id
      modelId
      type
      version {
        id
        ...ViewerModelVersionCardItem
        model {
          id
          ...ProjectPageLatestItemsModelItem
        }
      }
    }
  }
`)

export const onProjectVersionsPreviewGeneratedSubscription = graphql(`
  subscription OnProjectVersionsPreviewGenerated($id: String!) {
    projectVersionsPreviewGenerated(id: $id) {
      projectId
      objectId
      versionId
    }
  }
`)
