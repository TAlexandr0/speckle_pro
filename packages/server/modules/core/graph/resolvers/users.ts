'use strict'
import { UserInputError } from 'apollo-server-express'
import {
  getUserByEmail,
  getUserRole,
  deleteUser,
  searchUsers,
  changeUserRole,
  getUserById
} from '@/modules/core/services/users'
import { updateUserAndNotify } from '@/modules/core/services/users/management'
import { saveActivity } from '@/modules/activitystream/services'
import { ActionTypes } from '@/modules/activitystream/helpers/types'
import { validateScopes } from '@/modules/shared'
import zxcvbn from 'zxcvbn'
import { getAdminUsersListCollection } from '@/modules/core/services/users/adminUsersListService'
import { Roles, Scopes } from '@speckle/shared'
import { markOnboardingComplete } from '@/modules/core/repositories/users'
import { UsersMeta } from '@/modules/core/dbSchema'
import { getServerInfo } from '@/modules/core/services/generic'
import { throwForNotHavingServerRole } from '@/modules/shared/authz'
import { Resolvers, ResolversTypes } from '@/modules/core/graph/generated/graphql'

export = {
  Query: {
    async _() {
      return `Ph'nglui mglw'nafh Cthulhu R'lyeh wgah'nagl fhtagn.`
    },
    async activeUser(_parent, _args, context) {
      const activeUserId = context.userId
      if (!activeUserId) return null

      // Only if authenticated - check for server roles & scopes
      await throwForNotHavingServerRole(context, Roles.Server.Guest)
      await validateScopes(context.scopes, Scopes.Profile.Read)

      return await getUserById({ userId: activeUserId })
    },
    async otherUser(_parent, args) {
      const { id } = args
      if (!id) return null
      return await getUserById({ userId: id })
    },
    async user(_parent, args, context) {
      // User wants info about himself and he's not authenticated - just return null
      if (!context.auth && !args.id) return null

      await throwForNotHavingServerRole(context, Roles.Server.Guest)

      if (!args.id) await validateScopes(context.scopes, Scopes.Profile.Read)
      else await validateScopes(context.scopes, Scopes.Users.Read)

      const userId = args.id || context.userId
      if (!userId) throw new UserInputError('You must provide an user id.')

      return await getUserById({ userId })
    },

    async adminUsers(_parent, args) {
      return await getAdminUsersListCollection(args)
    },

    async userSearch(_parent, args, context) {
      await throwForNotHavingServerRole(context, Roles.Server.Guest)
      await validateScopes(context.scopes, Scopes.Profile.Read)
      await validateScopes(context.scopes, Scopes.Users.Read)

      if (args.query.length < 3)
        throw new UserInputError('Search query must be at least 3 carachters.')

      if (args.limit && args.limit > 100)
        throw new UserInputError(
          'Cannot return more than 100 items, please use pagination.'
        )

      const { cursor, users } = await searchUsers(
        args.query,
        args.limit,
        args.cursor || undefined,
        args.archived,
        args.emailOnly
      )
      return { cursor, items: users }
    },

    async userPwdStrength(_parent, args) {
      const res = zxcvbn(args.pwd)
      return { score: res.score, feedback: res.feedback }
    }
  },

  User: {
    async email(parent, _args, context) {
      // NOTE: we're redacting the field (returning null) rather than throwing a full error which would invalidate the request.
      if (context.userId === parent.id) {
        try {
          await validateScopes(context.scopes, Scopes.Profile.Email)
          return parent.email
        } catch (err) {
          return null
        }
      }

      try {
        // you should only have access to other users email if you have elevated privileges
        await throwForNotHavingServerRole(context, Roles.Server.Admin)
        await validateScopes(context.scopes, Scopes.Users.Email)
        return parent.email
      } catch (err) {
        return null
      }
    },
    async role(parent) {
      return await getUserRole(parent.id)
    },
    async isOnboardingFinished(parent, _args, ctx) {
      const metaVal = await ctx.loaders.users.getUserMeta.load({
        userId: parent.id,
        key: UsersMeta.metaKey.isOnboardingFinished
      })
      return !!metaVal?.value
    }
  },
  LimitedUser: {
    async role(parent) {
      return await getUserRole(parent.id)
    }
  },
  Mutation: {
    async userUpdate(_parent, args, context) {
      if (!context.userId) return false
      await throwForNotHavingServerRole(context, Roles.Server.Guest)
      await updateUserAndNotify(context.userId, args.user)
      return true
    },

    async userRoleChange(_parent, args) {
      const { guestModeEnabled } = await getServerInfo()
      await changeUserRole({
        role: args.userRoleInput.role,
        userId: args.userRoleInput.id,
        guestModeEnabled
      })
      return true
    },

    async adminDeleteUser(_parent, args, context) {
      await throwForNotHavingServerRole(context, Roles.Server.Admin)
      const user = await getUserByEmail({ email: args.userConfirmation.email })
      if (!user) return false

      await deleteUser(user.id)
      return true
    },

    async userDelete(_parent, args, context) {
      if (!context.userId)
        throw new UserInputError('You must be logged in to delete a user.')
      const user = await getUserById({ userId: context.userId })
      if (!user) throw new UserInputError('User not found.')

      if (args.userConfirmation.email !== user.email) {
        throw new UserInputError('Malformed input: emails do not match.')
      }

      // The below are not really needed anymore as we've added the hasRole and hasScope
      // directives in the graphql schema itself.
      // Since I am paranoid, I'll leave them here too.
      await throwForNotHavingServerRole(context, Roles.Server.Guest)
      await validateScopes(context.scopes, Scopes.Profile.Delete)

      await deleteUser(context.userId)

      await saveActivity({
        streamId: null,
        resourceType: 'user',
        resourceId: context.userId!,
        actionType: ActionTypes.User.Delete,
        userId: context.userId || null,
        info: {},
        message: 'User deleted'
      })

      return true
    },

    activeUserMutations: () => ({})
  },
  ActiveUserMutations: {
    async finishOnboarding(_parent, _args, ctx) {
      return await markOnboardingComplete(ctx.userId || '')
    },
    async update(_parent, args, context) {
      const newUser = await updateUserAndNotify(context.userId!, args.user)
      return newUser as unknown as ResolversTypes['User']
    }
  }
} as Resolvers
