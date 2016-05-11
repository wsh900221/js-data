import utils from './utils'
import Component from './Component'

const DOMAIN = 'Record'

const superMethod = function (mapper, name) {
  const store = mapper.datastore
  if (store && store[name]) {
    return function (...args) {
      return store[name](mapper.name, ...args)
    }
  }
  return mapper[name].bind(mapper)
}

/**
 * js-data's Record class.
 *
 * ```javascript
 * import {Record} from 'js-data'
 * ```
 *
 * @class Record
 * @extends Component
 * @param {Object} [props] The initial properties of the new Record instance.
 * @param {Object} [opts] Configuration options.
 * @param {boolean} [opts.noValidate=false] Whether to skip validation on the
 * initial properties.
 */
const Record = Component.extend({
  constructor: function Record (props, opts) {
    utils.classCallCheck(this, Record)

    props || (props = {})
    opts || (opts = {})
    const _props = {}
    Object.defineProperties(this, {
      _get: { value (key) { return utils.get(_props, key) } },
      _set: { value (key, value) { return utils.set(_props, key, value) } },
      _unset: { value (key) { return utils.unset(_props, key) } }
    })
    const _set = this._set
    // TODO: Optimize these strings
    _set('creating', true)
    if (opts.noValidate) {
      _set('noValidate', true)
    }
    utils.fillIn(this, props)
    _set('creating', false)
    _set('noValidate', false)
    _set('previous', utils.copy(props))
  },

  /**
   * TODO
   *
   * @name Record#_mapper
   * @method
   * @ignore
   */
  _mapper () {
    const mapper = this.constructor.mapper
    if (!mapper) {
      throw utils.err(`${DOMAIN}#_mapper`, '')(404, 'mapper')
    }
    return mapper
  },

  /**
   * TODO
   *
   * @name Record#afterLoadRelations
   * @method
   * @param {string[]} relations TODO
   * @param {Object} opts TODO
   */
  afterLoadRelations () {},

  /**
   * TODO
   *
   * @name Record#beforeLoadRelations
   * @method
   * @param {string[]} relations TODO
   * @param {Object} opts TODO
   */
  beforeLoadRelations () {},

  /**
   * Return changes to this record since it was instantiated or
   * {@link Record#commit} was called.
   *
   * @name Record#changes
   * @method
   * @param [opts] Configuration options.
   * @param {Function} [opts.equalsFn] Equality function. Default uses `===`.
   * @param {Array} [opts.ignore] Array of strings or RegExp of fields to ignore.
   */
  changes (opts) {
    opts || (opts = {})
    return utils.diffObjects(typeof this.toJSON === 'function' ? this.toJSON(opts) : this, this._get('previous'), opts)
  },

  /**
   * TODO
   *
   * @name Record#commit
   * @method
   */
  commit () {
    this._set('changed') // unset
    this._set('previous', utils.copy(this))
    return this
  },

  /**
   * Call {@link Mapper#destroy} using this record's primary key.
   *
   * @name Record#destroy
   * @method
   * @param {Object} [opts] Configuration options passed to {@link Mapper#destroy}.
   * @returns {Promise} The result of calling {@link Mapper#destroy}.
   */
  destroy (opts) {
    opts || (opts = {})
    const mapper = this._mapper()
    return superMethod(mapper, 'destroy')(utils.get(this, mapper.idAttribute), opts)
  },

  /**
   * Return the value at the given path for this instance.
   *
   * @name Record#get
   * @method
   * @param {string} key - Path of value to retrieve.
   * @returns {*} Value at path.
   */
  'get' (key) {
    return utils.get(this, key)
  },

  /**
   * Return whether this record has changed since it was instantiated or
   * {@link Record#commit} was called.
   *
   * @name Record#hasChanges
   * @method
   * @param [opts] Configuration options.
   * @param {Function} [opts.equalsFn] Equality function. Default uses `===`.
   * @param {Array} [opts.ignore] Array of strings or RegExp of fields to ignore.
   */
  hasChanges (opts) {
    const quickHasChanges = !!(this._get('changed') || []).length
    return quickHasChanges || utils.areDifferent(typeof this.toJSON === 'function' ? this.toJSON(opts) : this, this._get('previous'), opts)
  },

  /**
   * TODO
   *
   * @name Record#hashCode
   * @method
   */
  hashCode () {
    return utils.get(this, this._mapper().idAttribute)
  },

  isValid (opts) {
    return !this._mapper().validate(this, opts)
  },

  /**
   * TODO
   *
   * @name Record#loadRelations
   * @method
   * @param {string[]} [relations] TODO
   * @param {Object} [opts] TODO
   */
  loadRelations (relations, opts) {
    let op
    const mapper = this._mapper()

    // Default values for arguments
    relations || (relations = [])
    if (utils.isString(relations)) {
      relations = [relations]
    }
    opts || (opts = {})
    opts.with = relations

    // Fill in "opts" with the Model's configuration
    utils._(opts, mapper)
    opts.adapter = mapper.getAdapterName(opts)

    // beforeLoadRelations lifecycle hook
    op = opts.op = 'beforeLoadRelations'
    return utils.resolve(this[op](relations, opts)).then(() => {
      // Now delegate to the adapter
      op = opts.op = 'loadRelations'
      mapper.dbg(op, this, relations, opts)
      let tasks = []
      let task
      utils.forEachRelation(mapper, opts, (def, optsCopy) => {
        const relatedMapper = def.getRelation()
        optsCopy.raw = false
        if (utils.isFunction(def.load)) {
          task = def.load(mapper, def, this, opts)
        } else if (def.type === 'hasMany' || def.type === 'hasOne') {
          if (def.foreignKey) {
            task = superMethod(relatedMapper, 'findAll')({
              [def.foreignKey]: utils.get(this, mapper.idAttribute)
            }, optsCopy).then(function (relatedData) {
              if (def.type === 'hasOne') {
                return relatedData.length ? relatedData[0] : undefined
              }
              return relatedData
            })
          } else if (def.localKeys) {
            task = superMethod(relatedMapper, 'findAll')({
              where: {
                [relatedMapper.idAttribute]: {
                  'in': utils.get(this, def.localKeys)
                }
              }
            })
          } else if (def.foreignKeys) {
            task = superMethod(relatedMapper, 'findAll')({
              where: {
                [def.foreignKeys]: {
                  'contains': utils.get(this, mapper.idAttribute)
                }
              }
            }, opts)
          }
        } else if (def.type === 'belongsTo') {
          const key = utils.get(this, def.foreignKey)
          if (utils.isSorN(key)) {
            task = superMethod(relatedMapper, 'find')(key, optsCopy)
          }
        }
        if (task) {
          task = task.then((relatedData) => {
            def.setLocalField(this, relatedData)
          })
          tasks.push(task)
        }
      })
      return Promise.all(tasks)
    }).then(() => {
      // afterLoadRelations lifecycle hook
      op = opts.op = 'afterLoadRelations'
      return utils.resolve(this[op](relations, opts)).then(() => this)
    })
  },

  /**
   * TODO
   *
   * @name Record#previous
   * @method
   * @param {string} [key] TODO
   */
  previous (key) {
    if (key) {
      return this._get(`previous.${key}`)
    }
    return this._get('previous')
  },

  /**
   * TODO
   *
   * @name Record#revert
   * @method
   * @param {Object} [opts] Configuration options.
   */
  revert (opts) {
    const previous = this._get('previous')
    opts || (opts = {})
    opts.preserve || (opts.preserve = [])
    utils.forOwn(this, (value, key) => {
      if (key !== this._mapper().idAttribute && !previous.hasOwnProperty(key) && this.hasOwnProperty(key) && opts.preserve.indexOf(key) === -1) {
        delete this[key]
      }
    })
    utils.forOwn(previous, (value, key) => {
      if (opts.preserve.indexOf(key) === -1) {
        this[key] = value
      }
    })
    this.commit()
    return this
  },

  /**
   * Delegates to {@link Mapper#create} or {@link Mapper#update}.
   *
   * @name Record#save
   * @method
   * @param {Object} [opts] Configuration options. See {@link Mapper#create}.
   * @param [opts] Configuration options.
   * @param {boolean} [opts.changesOnly] Equality function. Default uses `===`.
   * @param {Function} [opts.equalsFn] Passed to {@link Record#changes} when
   * `changesOnly` is `true`.
   * @param {Array} [opts.ignore] Passed to {@link Record#changes} when
   * `changesOnly` is `true`.
   * @returns {Promise} The result of calling {@link Mapper#create} or
   * {@link Mapper#update}.
   */
  save (opts) {
    opts || (opts = {})
    const mapper = this._mapper()
    const id = utils.get(this, mapper.idAttribute)
    let props = this
    if (utils.isUndefined(id)) {
      return superMethod(mapper, 'create')(props, opts)
    }
    if (opts.changesOnly) {
      const changes = this.changes(opts)
      props = {}
      utils.fillIn(props, changes.added)
      utils.fillIn(props, changes.changed)
    }
    return superMethod(mapper, 'update')(id, props, opts)
  },

  /**
   * Set the value for a given key, or the values for the given keys if "key" is
   * an object.
   *
   * @name Record#set
   * @method
   * @param {(string|Object)} key - Key to set or hash of key-value pairs to set.
   * @param {*} [value] - Value to set for the given key.
   * @param {Object} [opts] - Optional configuration.
   * @param {boolean} [opts.silent=false] - Whether to trigger change events.
   */
  'set' (key, value, opts) {
    if (utils.isObject(key)) {
      opts = value
    }
    opts || (opts = {})
    if (opts.silent) {
      this._set('silent', true)
    }
    utils.set(this, key, value)
    if (!this._get('eventId')) {
      this._set('silent') // unset
    }
  },

  // TODO: move logic for single-item async operations onto the instance.

  /**
   * Return a plain object representation of this record. If the class from
   * which this record was created has a mapper, then {@link Mapper#toJSON} will
   * be called instead.
   *
   * @name Record#toJSON
   * @method
   * @param {Object} [opts] Configuration options.
   * @param {string[]} [opts.with] Array of relation names or relation fields
   * to include in the representation. Only available as an option if the class
   * from which this record was created has a mapper.
   * @returns {Object} Plain object representation of this record.
   */
  toJSON (opts) {
    const mapper = this.constructor.mapper
    if (mapper) {
      return mapper.toJSON(this, opts)
    } else {
      const json = {}
      utils.forOwn(this, function (prop, key) {
        json[key] = utils.copy(prop)
      })
      return json
    }
  },

  /**
   * Unset the value for a given key.
   *
   * @name Record#unset
   * @method
   * @param {string} key - Key to unset.
   * @param {Object} [opts] - Optional configuration.
   * @param {boolean} [opts.silent=false] - Whether to trigger change events.
   */
  unset (key, opts) {
    this.set(key, undefined, opts)
  },

  validate (opts) {
    return this._mapper().validate(this, opts)
  }
})

/**
 * Allow records to emit events.
 *
 * An record's registered listeners are stored in the record's private data.
 */
utils.eventify(
  Record.prototype,
  function () {
    return this._get('events')
  },
  function (value) {
    this._set('events', value)
  }
)

export default Record
