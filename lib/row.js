var async = require('async')

var Row = module.exports = function Row(rs, table) {
  var self = this
  if (!(self instanceof Row)) {
    return new Row(rs, table)
  }

  Object.defineProperty(self, '_meta', {
      enumerable: false,
      writable: true
  })
  Object.defineProperty(self, '_data', {
      enumerable: false,
      writable: true
  })
  self._meta = table
  // take a snapshot of the data so we only save() what is changed
  self._data = JSON.parse(JSON.stringify(rs))

  for (var attr in rs) {
    self[attr] = rs[attr]
  }

  if (table.construct && typeof table.construct === 'function') {
    table.construct.call(self)
  }

  // bind user defined row methods to this row instance
  Object.keys(table._methods).forEach(function(method) {
    self[method] = table._methods[method].bind(self)
  })
}


Row.prototype.dump = function() {
  console.log(this._meta.name + '(' +  this.getPrimaryKey() + '):', this);
}

Row.prototype.set = function(data) {
  var self = this
  Object.keys(data).forEach(function(field) {
    self._data[field] = self[field]
    self[field] = data[field]
  })
}

Row.prototype.save = function(cb) {
  var self = this
  var update = {}
  Object.keys(self._data).forEach(function(field) {
    if (self[field] !== self._data[field]) {
      update[field] = self[field]
    }
  })
  self.update(update, cb)
}

Row.prototype.hydrate = function(fkName, cb) {
  var self = this
  if (self._meta.fk && self._meta.fk[fkName]) {
    var fk = self._meta.fk[fkName]
    var property = fk.constraintName
    var fkTable = fk.foreignTable
    var fkPk = {}
    fk.columns.forEach(function(column, i) {
      fkPk[fk.foreignColumns[i]] = self[column]
    })
    table.orm[fkTable].get(fkPk, function(err, obj) {
      if (err) return cb(err)
      self[fkName] = obj
      cb(null, obj)
    })
  }
}


Row.prototype.getPrimaryKey = function() {
  var self = this
  var pk = {}
  self._meta.primaryKey.forEach(function(field) {
    pk[field] = self[field]
  })
  return pk
}


Row.prototype.getCacheKey = function() {
  var self = this
  var pk = self.getPrimaryKey()
  var cacheKey = ''
  Object.keys(pk).forEach(function(k) {
    var val = pk[k]
    if (cacheKey) cacheKey = cacheKey + ','
    cacheKey = cacheKey + val
  })
  cacheKey = self._meta.name + ':' + cacheKey
  return cacheKey
}


// TODO: if the primary key value changes, refresh old and new cache
Row.prototype.update = function(data, cb) {
  var self = this
  // remove undefined values
  data = JSON.parse(JSON.stringify(data))
  var set = []
  Object.keys(data).forEach(function(field) {
    set.push(field + ' = :' + field)
  })
  var pk = self.getPrimaryKey()
  var pkWhere = table.getPrimaryKeyWhereClause(pk)
  var sql = [
    'UPDATE "' + this._meta.name + '"',
    'SET ' + set.join(',\n'),
    'WHERE ' + pkWhere,
    'RETURNING *'
  ].join('\n');
  self._meta.orm.execute(sql, data, {write: true}, function(err, rs) {
    if (err) return cb(err)
    // reinstantiate this object with the updated values
    self = new Row(rs[0], self._meta)
    // invalidate the memoization
    self._meta.invalidateMemo(pk)
    var opts = self._meta.orm._opts
    if (!opts.cache || typeof opts.cache.set !== 'function') {
      return cb(null, self)
    }
    // save to cache
    var cacheKey = self.getCacheKey()
    opts.cache.set(cacheKey, JSON.stringify(rs[0]), function(err) {
      if (err) return cb(err)
      cb(null, self)
    })
  })
}

