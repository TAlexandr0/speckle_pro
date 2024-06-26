import knex from '@/db/knex'
import { ForbiddenError } from '@/modules/shared/errors'
import {
  buildCommentTextFromInput,
  validateInputAttachments
} from '@/modules/comments/services/commentTextService'
import { CommentsEmitter, CommentsEvents } from '@/modules/comments/events/emitter'
import { Roles } from '@speckle/shared'
import { CommentCreateInput, CommentEditInput, ResourceIdentifier } from '@/modules/core/graph/generated/graphql'
import { CommentLinkRecord, CommentRecord } from '@/modules/comments/domain/types'
import { JSONContent } from '@tiptap/core'
import { DeleteComment, GetStreamCommentCount, InsertComment, InsertCommentLinks, LegacyGetComment, MarkCommentUpdated, MarkCommentViewed, UpdateComment } from '@/modules/comments/domain/operations'

// const Comments = () => knex('comments')
// const CommentLinks = () => knex('comment_links')

const resourceCheckFactory =
  ({
    legacyGetComment
  }: {
    legacyGetComment: LegacyGetComment
  }) =>
    async (res: ResourceIdentifier, streamId: string) => {
      // The `switch` of DOOM👻😩😨👻 - if something throws, we're out
      switch (res.resourceType) {
        case 'stream':
          // Stream validity is already checked, so we can just go ahead.
          break
        case 'commit': {
          const linkage = await knex('stream_commits')
            .select()
            .where({ commitId: res.resourceId, streamId })
            .first()
          if (!linkage) throw new Error('Commit not found')
          if (linkage.streamId !== streamId)
            throw new Error(
              'Stop hacking - that commit id is not part of the specified stream.'
            )
          break
        }
        case 'object': {
          const obj = await knex('objects')
            .select()
            .where({ id: res.resourceId, streamId })
            .first()
          if (!obj) throw new Error('Object not found')
          break
        }
        case 'comment': {
          const comment = await legacyGetComment({ id: res.resourceId })
          if (!comment) throw new Error('Comment not found')
          if (comment.streamId !== streamId)
            throw new Error(
              'Stop hacking - that comment is not part of the specified stream.'
            )
          break
        }
        default:
          throw Error(
            `resource type ${res.resourceType} is not supported as a comment target`
          )
      }
    }

export const streamResourceCheckFactory =
  ({
    legacyGetComment
  }: {
    legacyGetComment: LegacyGetComment
  }) =>
    async ({ streamId, resources }: { streamId: string, resources: ResourceIdentifier[] }) => {
      // this itches - a for loop with queries... but okay let's hit the road now
      await Promise.all(resources.map((res) => resourceCheckFactory({ legacyGetComment })(res, streamId)))
    }

/**
 * @deprecated Use 'createCommentThreadAndNotify()' instead
 */
export const createCommentFactory =
  ({
    deleteComment,
    insertComment,
    insertCommentLinks
  }: {
    deleteComment: DeleteComment,
    insertComment: InsertComment,
    insertCommentLinks: InsertCommentLinks
  }) =>
    async ({ userId, input }: { userId: string, input: CommentCreateInput }): Promise<CommentRecord> => {
      if (input.resources.length < 1)
        throw Error('Must specify at least one resource as the comment target')

      const commentResource = input.resources.find((r) => r?.resourceType === 'comment')
      if (commentResource) throw new Error('Please use the comment reply mutation.')

      // Stream checks
      const streamResources = input.resources.filter((r) => r?.resourceType === 'stream')
      if (streamResources.length > 1)
        throw Error('Commenting on multiple streams is not supported')

      const [stream] = streamResources
      if (stream && stream.resourceId !== input.streamId)
        throw Error("Input streamId doesn't match the stream resource.resourceId")

      // TODO: Inject blobstorage module repo
      await validateInputAttachments(input.streamId, input.blobIds)

      const comment = {
        streamId: input.streamId,
        text: buildCommentTextFromInput({
          doc: input.text,
          blobIds: input.blobIds
        }),
        data: input.data,
        screenshot: input.screenshot,
        authorId: userId
      }

      const newComment = await insertComment(comment)

      try {
        await module.exports.streamResourceCheck({
          streamId: input.streamId,
          resources: input.resources
        })
        for (const res of input.resources) {
          if (!res) {
            continue
          }

          await insertCommentLinks({
            commentLinks: [
              {
                commentId: newComment.id,
                resourceId: res.resourceId,
                resourceType: res.resourceType
              }
            ]
          })
        }
      } catch (e) {
        await deleteComment({ commentId: newComment.id }) // roll back
        throw e // pass on to resolver
      }
      await module.exports.viewComment({ userId, commentId: newComment.id }) // so we don't self mark a comment as unread the moment it's created

      await CommentsEmitter.emit(CommentsEvents.Created, {
        comment: newComment
      })

      return newComment
    }

type CreateCommentReplyParams = {
  authorId: string
  parentCommentId: string
  streamId: string
  text: JSONContent | null
  data: CommentRecord['data']
  blobIds: string[]
}

/**
 * @deprecated Use 'createCommentReplyAndNotify()' instead
 */
export const createCommentReplyFactory =
  ({
    deleteComment,
    insertComment,
    insertCommentLinks,
    markCommentUpdated
  }: {
    deleteComment: DeleteComment,
    insertComment: InsertComment,
    insertCommentLinks: InsertCommentLinks,
    markCommentUpdated: MarkCommentUpdated
  }) =>
    async ({
      authorId,
      parentCommentId,
      streamId,
      text,
      data,
      blobIds
    }: CreateCommentReplyParams) => {
      await validateInputAttachments(streamId, blobIds)
      const comment = {
        // id: crs({ length: 10 }),
        authorId,
        text: buildCommentTextFromInput({ doc: text, blobIds }),
        data,
        streamId,
        parentComment: parentCommentId
      }

      const newComment = await insertComment(comment)
      try {
        const commentLink: Omit<CommentLinkRecord, 'commentId'> = { resourceId: parentCommentId, resourceType: 'comment' }
        await module.exports.streamResourceCheck({
          streamId,
          resources: [commentLink]
        })
        await insertCommentLinks({ commentLinks: [{ commentId: newComment.id, ...commentLink }] })
      } catch (e) {
        await deleteComment({ commentId: newComment.id }) // roll back
        throw e // pass on to resolver
      }
      await markCommentUpdated({ commentId: parentCommentId })

      await CommentsEmitter.emit(CommentsEvents.Created, {
        comment: newComment
      })

      return newComment
    }

/**
 * @deprecated Use 'editCommentAndNotify()'
 */
export const editCommentFactory =
  ({
    legacyGetComment,
    updateComment
  }: {
    legacyGetComment: LegacyGetComment,
    updateComment: UpdateComment
  }) =>
    async ({ userId, input, matchUser = false }: { userId: string, input: CommentEditInput, matchUser: boolean }): Promise<CommentRecord> => {
      const editedComment = await legacyGetComment({ id: input.id })
      if (!editedComment) throw new Error("The comment doesn't exist")

      if (matchUser && editedComment.authorId !== userId)
        throw new ForbiddenError("You cannot edit someone else's comments")

      await validateInputAttachments(input.streamId, input.blobIds)
      const newText = buildCommentTextFromInput({
        doc: input.text,
        blobIds: input.blobIds
      })

      const updatedComment = await updateComment({ id: input.id, input: { text: newText } })

      await CommentsEmitter.emit(CommentsEvents.Updated, {
        previousComment: editedComment,
        newComment: updatedComment
      })

      return updatedComment
    }

/**
 * @deprecated Use 'markCommentViewed()'
 */
export const viewCommentFactory =
  ({
    markCommentViewed
  }: {
    markCommentViewed: MarkCommentViewed
  }) =>
    async ({ userId, commentId }: { userId: string, commentId: string }) => {
      await markCommentViewed({ commentId, userId })
    }

/**
 * @deprecated Use 'archiveCommentAndNotify()'
 */
export const archiveCommentFactory =
  ({
    legacyGetComment,
    updateComment
  }: {
    legacyGetComment: LegacyGetComment,
    updateComment: UpdateComment
  }) =>
    async ({ commentId, userId, streamId, archived = true }: { commentId: string, userId: string, streamId: string, archived: boolean }): Promise<CommentRecord> => {
      const comment = await legacyGetComment({ id: commentId })
      if (!comment)
        throw new Error(
          `No comment ${commentId} exists, cannot change its archival status`
        )

      // TODO: Inject auth (?) repository method
      const aclEntry = await knex('stream_acl')
        .select()
        .where({ resourceId: streamId, userId })
        .first()

      if (comment.authorId !== userId) {
        if (!aclEntry || aclEntry.role !== Roles.Stream.Owner)
          throw new ForbiddenError("You don't have permission to archive the comment")
      }

      const updatedComment = await updateComment({ id: commentId, input: { archived } })

      return updatedComment
    }

// /**
//  * @deprecated Use `getPaginatedProjectComments()` instead
//  */
// export const getComments = async ({
//   resources,
//   limit,
//   cursor,
//   userId = null,
//   replies = false,
//   streamId,
//   archived = false
// }) => {
//   const query = knex.with('comms', (cte) => {
//     cte.select().distinctOn('id').from('comments')
//     cte.join('comment_links', 'comments.id', '=', 'commentId')

//     if (userId) {
//       // link viewed At
//       cte.leftOuterJoin('comment_views', (b) => {
//         b.on('comment_views.commentId', '=', 'comments.id')
//         b.andOn('comment_views.userId', '=', knex.raw('?', userId))
//       })
//     }

//     if (resources && resources.length !== 0) {
//       cte.where((q) => {
//         // link resources
//         for (const res of resources) {
//           q.orWhere('comment_links.resourceId', '=', res.resourceId)
//         }
//       })
//     } else {
//       cte.where({ streamId })
//     }
//     if (!replies) {
//       cte.whereNull('parentComment')
//     }
//     cte.where('archived', '=', archived)
//   })

//   query.select().from('comms')

//   // total count coming from our cte
//   query.joinRaw('right join (select count(*) from comms) c(total_count) on true')

//   // get comment's all linked resources
//   query.joinRaw(`
//       join(
//         select cl."commentId" as id, JSON_AGG(json_build_object('resourceId', cl."resourceId", 'resourceType', cl."resourceType")) as resources
//         from comment_links cl
//         join comms on comms.id = cl."commentId"
//         group by cl."commentId"
//       ) res using(id)`)

//   if (cursor) {
//     query.where('createdAt', '<', cursor)
//   }

//   limit = clamp(limit ?? 10, 0, 100)
//   query.orderBy('createdAt', 'desc')
//   query.limit(limit || 1) // need at least 1 row to get totalCount

//   const rows = await query
//   const totalCount = rows && rows.length > 0 ? parseInt(rows[0].total_count) : 0
//   const nextCursor = rows && rows.length > 0 ? rows[rows.length - 1].createdAt : null

//   return {
//     items: !limit ? [] : rows,
//     cursor: nextCursor ? nextCursor.toISOString() : null,
//     totalCount
//   }
// }

// export const getResourceCommentCount = ({ }) async ({ resourceId }) => {
//   const [res] = await CommentLinks()
//     .count('commentId')
//     .where({ resourceId })
//     .join('comments', 'comments.id', '=', 'commentId')
//     .where('comments.archived', '=', false)

//   if (res && res.count) {
//     return parseInt(res.count)
//   }
//   return 0
// }

export const getStreamCommentCountFactory =
  ({
    getStreamCommentCount
  }: {
    getStreamCommentCount: GetStreamCommentCount
  }) =>
    async ({ streamId }: { streamId: string }) => {
      return (await getStreamCommentCount({ streamId })) || 0
    }
