import { BaseError } from '@/modules/shared/errors'
import { Options } from 'verror'

export class ObjectHandlingError extends BaseError {
  static defaultMessage = 'Failed to handle object.'
  static code = 'OBJECT_HANDLING_ERROR'

  constructor(message?: string | undefined, options?: Options | Error | undefined) {
    super(message, options)
  }
}

export class ObjectNotFoundError extends BaseError {
  static defaultMessage = 'Object not found.'
  static code = 'OBJECT_NOT_FOUND'
}
