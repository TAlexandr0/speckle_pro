import * as THREE from 'three'
import ObjectWrapper from './ObjectWrapper'
import { getConversionFactor } from './Units'

/**
 * Utility class providing some top level conversion methods.
 */
export default class Coverter {

  constructor( objectLoader ) {
    if ( !objectLoader ) {
      console.warn( 'Converter initialized without a corresponding object loader. Any objects that include references will throw errors.' )
    }

    this.objectLoader = objectLoader
  }

  /**
   * If the object is convertable (there is a direct conversion routine), it will invoke the callback with the conversion result.
   * If the object is not convertable, it will recursively iterate through it (arrays & objects) and invoke the callback on any postive conversion result.
   * @param  {[type]}   obj      [description]
   * @param  {Function} callback [description]
   * @return {[type]}            [description]
   */
  async traverseAndConvert( obj, callback ) {
    // Handle primitives (string, ints, bools, bigints, etc.)
    if ( typeof obj !== 'object' ) return

    // Populate references
    if ( obj.referencedId ) obj = await this.resolveReference( obj )

    // Traverse arrays
    if ( Array.isArray( obj ) ) {
      for ( let element of obj ) {
        ( async() => await this.traverseAndConvert( element, callback ) )() //iife so we don't block
      }
    }

    // If we can convert it, we should invoke the respective conversion routine.
    const type = this.getSpeckleType( obj )
    if ( this[`${type}ToBufferGeometry`] ) {
      callback( await this[`${type}ToBufferGeometry`]( obj.data || obj ) )
      return
    }

    // Otherwise, traverse the object in case there's any sub-objects we can convert.
    for ( let prop in obj.data ) {
      ( async() => await this.traverseAndConvert( obj.data[prop], callback ) )() //iife so we don't block
    }
  }

  /**
   * Directly converts an object and invokes the callback with the the conversion result.
   * @param  {[type]} obj [description]
   * @param  {Function} callback [description]
   * @return {[type]}     [description]
   */
  async convert( obj, callback ) {
    let type = this.getSpeckleType( obj )

    if ( this[`${type}ToBufferGeometry`] ) callback( await this[`${type}ToBufferGeometry`]( obj.data || obj ) )
    else return
  }

  /**
   * Takes an array composed of chunked references and dechunks it.
   * @param  {[type]} arr [description]
   * @return {[type]}     [description]
   */
  async dechunk( arr ) {
    // Handles pre-chunking objects, or arrs that have not been chunked
    if ( !arr[0].referencedId ) return arr

    let dechunked = []
    for ( let ref of arr ) {
      let real = await this.objectLoader.getObject( ref.referencedId )
      dechunked.push( ...real.data )
    }
    return dechunked
  }

  /**
   * Resolves an object reference by waiting for the loader to load it up.
   * @param  {[type]} obj [description]
   * @return {[type]}     [description]
   */
  async resolveReference( obj ) {
    if ( obj.referencedId )
      return await this.objectLoader.getObject( obj.referencedId )
    else return obj
  }

  /**
   * Gets the speckle type of an object in various scenarios.
   * @param  {[type]} obj [description]
   * @return {[type]}     [description]
   */
  getSpeckleType( obj ) {
    let type = 'Base'
    if ( obj.data )
      type = obj.data.speckle_type ? obj.data.speckle_type.split( '.' ).reverse()[0] : type
    else
      type = obj.speckle_type ? obj.speckle_type.split( '.' ).reverse()[0] : type
    return type
  }

  // TODOs:
  // async PointToBufferGeometry( obj ) {}
  // async LineToBufferGeometry( obj ) {}
  // async PolylineToBufferGeometry( obj ) {}
  // async PolycurveToBufferGeometry( obj ) {}
  // async CurveToBufferGeometry( obj ) {}
  // async CircleToBufferGeometry( obj ) {}
  // async ArcToBufferGeometry( obj ) {}
  // async EllipseToBufferGeometry( obj ) {}
  // async SurfaceToBufferGeometry( obj ) {}

  async BrepToBufferGeometry( obj ) {
    if ( !obj ) return
    let { bufferGeometry }  = await this.MeshToBufferGeometry( await this.resolveReference( obj.displayValue || obj.displayMesh ) )

    delete obj.displayMesh
    delete obj.displayValue
    delete obj.Edges
    delete obj.Faces
    delete obj.Loops
    delete obj.Trims
    delete obj.Curve2D
    delete obj.Curve3D
    delete obj.Surfaces
    delete obj.Vertices

    return new ObjectWrapper( bufferGeometry, obj )
  }

  async MeshToBufferGeometry( obj ) {
    if ( !obj ) return

    let conversionFactor = getConversionFactor( obj.units )
    let buffer = new THREE.BufferGeometry( )
    let indices = [ ]

    let vertices = await this.dechunk( obj.vertices )
    let faces = await this.dechunk( obj.faces )

    let k = 0
    while ( k < faces.length ) {
      if ( faces[ k ] === 1 ) { // QUAD FACE
        indices.push( faces[ k + 1 ], faces[ k + 2 ], faces[ k + 3 ] )
        indices.push( faces[ k + 1 ], faces[ k + 3 ], faces[ k + 4 ] )
        k += 5
      } else if ( faces[ k ] === 0 ) { // TRIANGLE FACE
        indices.push( faces[ k + 1 ], faces[ k + 2 ], faces[ k + 3 ] )
        k += 4
      } else throw new Error( `Mesh type not supported. Face topology indicator: ${faces[k]}` )
    }
    buffer.setIndex( indices )

    buffer.setAttribute(
      'position',
      new THREE.Float32BufferAttribute( conversionFactor === 1 ? vertices : vertices.map( v => v * conversionFactor ), 3 ) )

    buffer.computeVertexNormals( )
    buffer.computeFaceNormals( )
    buffer.computeBoundingSphere( )

    delete obj.vertices
    delete obj.faces

    return new ObjectWrapper( buffer, obj )
  }

}
