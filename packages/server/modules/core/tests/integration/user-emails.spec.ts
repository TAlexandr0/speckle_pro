import { before } from 'mocha'
import { createUser } from '@/modules/core/services/users'
import { beforeEachContext } from '@/test/hooks'
import { expect } from 'chai'
import { getUserByEmail } from '@/modules/core/repositories/users'
import { UserRecord } from '@/modules/core/helpers/types'
import crs from 'crypto-random-string'

function createRandomEmail() {
  return `${crs({ length: 6 })}@example.org`
}

describe('Core @user-emails', () => {
  before(async () => {
    await beforeEachContext()
  })
  describe('getUserByEmail', () => {
    it('should return null if user does not exist', async () => {
      expect(await getUserByEmail('test@example.org')).to.be.null
    })

    it('should return user if user-email does not exist', async () => {
      const email = createRandomEmail()
      await createUser({
        name: 'John Doe',
        email,
        password: 'sn3aky-1337-b1m'
      })
      // TODO: delete user email

      const user = (await getUserByEmail('test@example.org')) as UserRecord
      expect(user.name).to.eq('John Doe')
      expect(user.email).to.eq(email)
    })

    it('should return user merged with user-email', async () => {
      const email = createRandomEmail()
      await createUser({
        name: 'John Doe',
        email,
        password: 'sn3aky-1337-b1m'
      })

      const user = (await getUserByEmail(email)) as UserRecord
      expect(user.name).to.eq('John Doe')
      expect(user.email).to.eq(email)
    })
  })
})
