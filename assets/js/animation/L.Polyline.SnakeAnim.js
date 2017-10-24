///// FIXME: Use path._rings instead of path._latlngs???
///// FIXME: Panic if this._map doesn't exist when called.
///// FIXME: Implement snakeOut()
///// FIXME: Implement layerGroup.snakeIn() / Out()

/**
 * These are the additions to Polyline, this is not used directly, but still seems to 
 *  control the smooth 'snaking' effect. Without it it just jumps section by section
 */
L.Polyline.include({

	// Hi-res timestamp indicating when the last calculations for vertices and distance took place.
	_snakingTimestamp: 0,

	// How many rings and vertices we've already visited
	// Yeah, yeah, "rings" semantically only apply to polygons, but L.Polyline internally uses that nomenclature.
	_snakingRings: 0,
	_snakingVertices: 0,

	// Distance to draw (in screen pixels) since the last vertex
	_snakingDistance: 0,

	// Flag
	_snaking: false,

	/// TODO: accept a 'map' parameter, fall back to addTo() in case performance.now is not available.
	snakeIn: function(){

		// don't do anything if already snaking
		if (this._snaking) { return; }

		// I think that this is checking for requirements - don't do anything if not met
		if ( !('performance' in window) ||
		     !('now' in window.performance) ||
		     !this._map) {
			return;
		}

		//set flag to true, timestamp to now and counters to 0
		this._snaking = true;
		this._snakingTime = performance.now();
		this._snakingVertices = this._snakingRings = this._snakingDistance = 0;

		// get the list of coordinates from the polyline
		if (!this._snakeLatLngs) {
			this._snakeLatLngs = L.Polyline._flat(this._latlngs) ?
				[ this._latlngs ] :
				this._latlngs ;
		}

		// Init with just the first (0th) vertex in a new ring
		// Twice because the first thing that this._snake is is chop the head.
		this._latlngs = [[ this._snakeLatLngs[0][0], this._snakeLatLngs[0][0] ]];

		// dunno...
		this._update();
		
		// start snaking...?
		this._snake();
		
		// doesn't do anything as it doesn't propagate
		this.fire('snakestart');
		return this;
	},


	_snake: function(){
		
		//get the time, use it to work out the speed and then update
		var now = performance.now();
		var diff = now - this._snakingTime;	// In milliseconds
		var forward = diff * this.options.snakingSpeed / 1000;	// In pixels
		this._snakingTime = now;

		// Chop the head from the previous frame
		this._latlngs[ this._snakingRings ].pop();

		//move the snake forward...?
		return this._snakeForward(forward);
	},

	_snakeForward: function(forward) {

		// Calculate distance from current vertex to next vertex
		var currPoint = this._map.latLngToContainerPoint(
			this._snakeLatLngs[ this._snakingRings ][ this._snakingVertices ]);
		var nextPoint = this._map.latLngToContainerPoint(
			this._snakeLatLngs[ this._snakingRings ][ this._snakingVertices + 1 ]);
		var distance = currPoint.distanceTo(nextPoint);

// 		console.log('Distance to next point:', distance, '; Now at: ', this._snakingDistance, '; Must travel forward:', forward);
// 		console.log('Vertices: ', this._latlngs);

		
		if (this._snakingDistance + forward > distance) {

			// Jump to next vertex
			this._snakingVertices++;
			this._latlngs[ this._snakingRings ].push( this._snakeLatLngs[ this._snakingRings ][ this._snakingVertices ] );

			if (this._snakingVertices >= this._snakeLatLngs[ this._snakingRings ].length - 1 ) {

				//are we finished?
				if (this._snakingRings >= this._snakeLatLngs.length - 1 ) {

					// fire the snakepausestart event
					this.fire("snakepausestart", null, true);
				
					return this._snakeEnd();
				} else {
					//er...?
					this._snakingVertices = 0;
					this._snakingRings++;
					this._latlngs[ this._snakingRings ] = [
						this._snakeLatLngs[ this._snakingRings ][ this._snakingVertices ]
					];
				}
			}

			// decrement distance and go again
			this._snakingDistance -= distance;
			return this._snakeForward(forward);
		}

		this._snakingDistance += forward;

		var percent = this._snakingDistance / distance;

		var headPoint = nextPoint.multiplyBy(percent).add(
			currPoint.multiplyBy( 1 - percent )
		);

		// Put a new head in place.
		var headLatLng = this._map.containerPointToLatLng(headPoint);
		this._latlngs[ this._snakingRings ].push(headLatLng);

		this.setLatLngs(this._latlngs);
		this.fire('snakepauseend');
		L.Util.requestAnimFrame(this._snake, this);
	},
	
	//clean up and finish
	_snakeEnd: function() {
		this.setLatLngs(this._snakeLatLngs);
		this._snaking = false;
		this.fire('snakeend');
	}
});

// add additional option for 'smooth' snaking speed
L.Polyline.mergeOptions({
	snakingSpeed: 200	// In pixels/sec
});


/****************************************************************************************/


/**
 * These are the additions to the Layer Group - this is what is actually called by our code
 */
L.LayerGroup.include({

	_snakingLayers: [],
	_snakingLayersDone: 0,

	// this is used for the actual start, the above snakeIn is then used for each section
	snakeIn: function() {
		
		// requirement checks
		if ( !('performance' in window) ||
		     !('now' in window.performance) ||
		     !this._map ||
		     this._snaking) {
			return;
		}
		
		// setup
		this._snaking = true;
		this._snakingLayers = [];
		this._snakingLayersDone = 0;
		
		// not quite sure what this is...
		var keys = Object.keys(this._layers);
		for (var i in keys) {
			var key = keys[i];
			this._snakingLayers.push(this._layers[key]);
		}
		this.clearLayers();

		//this is the one that is called at the start
		this.fire('snakestart');
		return this._snakeNext();
	},

	//
	_snakeNext: function() {

		// are we done with now snaking now?
		if (this._snakingLayersDone >= this._snakingLayers.length) {
			this.fire('snakeend');	//this is the one that fires
			this._snaking = false;
			return;
		}
		
		// get current layer
		var currentLayer = this._snakingLayers[this._snakingLayersDone];
		
		// set the pause (either the individual layer one or, if not, the group one set below)
		var pause = currentLayer.options.snakingPause
			? currentLayer.options.snakingPause
			: this.options.snakingPause;

		// count done layers
		this._snakingLayersDone++;
		
		//add the current layer to the group
		this.addLayer(currentLayer);
		
		//if the currentLayer has a snakeIn function
		if ('snakeIn' in currentLayer) {
			
			//add a timeout to the snakeend event on the current layer
			currentLayer.once('snakeend', function(){	// 'once' means listener gets fired only once then removed
				setTimeout(this._snakeNext.bind(this), pause);
			}, this);
			
			//snakes the current layer
			currentLayer.snakeIn();
			
		} else {
		
			//otherwise, just add the timeout on its own
			setTimeout(this._snakeNext.bind(this), pause);
		}
		
		//then fire snakepause
		this.fire('snakepauseend');	//THIS IS THE ONE THAT FIRES
		return this;
	}

});

//add the default pause timer value to the LayerGroup options
L.LayerGroup.mergeOptions({
	snakingPause: 2000
});







