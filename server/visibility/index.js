var wktparse = require('wellknown');

var db = null;
var grid_size = 2;
var layers = {};
var layerTmpl = {
	type: 'FeatureCollection',
	features: []
}

function init(database) {
  var now = Math.round((new Date()).getTime() / 1000);
  db = database;

  initVisibilityLayer(now, 1, function(err, layer){
    if( err ) {
      console.log('error initializing visibility layer: ' + err);
    } else {
      console.log('visibility layer initialized');
    }
  });
}

function visibilityLayer(timestamp, landmark) {
  return layers[landmark] || {};
}

function initVisibilityLayer(timestamp, landmark, next) {
  var processCheckins;

  layers[landmark] = layerTmpl;
  processCheckins = updateVisibilityLayerWithCheckins(timestamp, landmark, next);
  db.getCheckinsForDay(timestamp, landmark, processCheckins);
}

function updateVisibilityLayerWithCheckins(timestamp, landmark, next) {
  return function(err, checkins) {
    var i = 0;

    if( err ) {
      next(err,null);
      return;
    }

    if( checkins.length === 0 ) {
      next(null, layers[landmark]);
    }

    checkins.forEach(function(checkin) {
      checkin.coords = {
        longitude: wktparse(checkin.location).coordinates[0],
        latitude: wktparse(checkin.location).coordinates[1]
      };
      updateVisibilityLayer(timestamp, landmark, checkin, done);
    });

    function done() {
      if( ++i === checkins.length ) {
        next(null, layers[landmark]);
      }
    }
  };
}

function updateVisibilityLayer(timestamp, landmark, checkin, next) {
  db.nearLandmark(checkin.coords, landmark, function(err, near) {
    var cell;

    next = next || function() {};

    if( err ) {
      next(err);
      return;
    }

    if( !near ) {
      next(null, layers[landmark]);
      return;
    }

    cell = cellForCheckin(checkin, grid_size);

    db.getCheckinsForDayInCell(timestamp, landmark, cell, function(err, checkins) {
      if( err ) {
        next(err, null);
        return;
      }
      if( checkins.length ) {
        updateGeoJSON(layers[landmark], cell, aggregateVisibility(checkins), aggregateAccuracy(checkins));
      }
      next(null, layers[landmark]);
    });
  });
}

function aggregateAccuracy(checkins){
  var accuracy = checkins.reduce(function(memo, checkin) {
    memo += 100 - (checkin.age * 10);
    return memo;
  }, 0);
  return accuracy / checkins.length;
}

function cellForCheckin(checkin, precision) {
  var left = roundDown(checkin.coords.longitude, precision),
    right = roundDown(left + Math.pow(10, precision * -1), precision),
    bottom = roundDown(checkin.coords.latitude, precision),
    top = roundDown(bottom + Math.pow(10, precision * -1), precision);
  return {
    type: "Polygon",
    coordinates: [
      [[left, top], [right, top], [right, bottom], [left, bottom], [left, top]]
    ]
  };
}

function aggregateVisibility(checkins) {
  var weights = [10, 9, 8 , 7, 6, 5, 4, 3, 2 , 1, 0];
  return checkins.reduce(weightedSum(weights), 0) / checkins.length / 10;
}

function updateGeoJSON(layer, cell, visibility, accuracy) {
  var clientCell, index, id;

  clientCell = {
    type: 'Polygon',
    coordinates: [cell.coordinates[0]]
  };

  id =  cellId(clientCell);

  existing = objById(layer.features, id);

  if( existing === null ) {
    layer.features.push({
      type: 'Feature',
      id: id,
      properties: {visibility: visibility, accuracy: accuracy},
      geometry: clientCell
    });
  } else {
    existing.properties.visibility = visibility;
    existing.properties.accuracy = accuracy;
  }
}

function cellId(cell) {
  return cell.coordinates[0].map(function(coord) { return coord.join('|'); }).join('||');
}

function objById(collection, id) {
  var result = null;
  collection.forEach(function(obj) {
    if( result === null && obj.id === id ) {
      result = obj;
    }
  });
  return result;
}

function weightedSum(weights) {
  return function(memo, checkin) {
    memo += (weights[checkin.age] || 0) * checkin.visibility;
    return memo;
  };
}

function roundDown(number, precision) {
  var mantissa = Math.pow(10, precision);
  return Math.floor(number * mantissa) / mantissa;
}

exports.init = init;
exports.updateVisibilityLayer = updateVisibilityLayer;
exports.cellForCheckin = cellForCheckin;