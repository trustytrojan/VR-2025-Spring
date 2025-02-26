import * as cg from '../render/core/cg.js';
import { lcb, rcb } from '../handle_scenes.js'; // controller beams
import { buttonState } from '../render/core/controllerInput.js';
import { G2 } from '../util/g2.js';

/**
 * @typedef {import('../render/core/clay.js').Node} Node
 * @typedef {[number, number, number]} Vec3
 * @typedef {'left' | 'right'} Hand
 */

/**
 * Check if a position vector is farther than maxPos in any dimension
 * @param {number[]} vec
 * @param {number} maxPos 
 */
const isFartherThan = (vec, maxPos) => vec.some(x => Math.abs(x) > maxPos);

/** @param {number[]} v */
const vecNegate = (v) => v.map(x => -x);

/**
 * Inspiration taken from `ControllerBeam.projectOntoBeam`
 * @param {Hand} hand
 */
const beamVector = (hand) => vecNegate(((hand === 'left') ? lcb : rcb).beamMatrix().slice(8, 11));

/**
 * Check if a position is inside the polygon formed by the vertices
 * @param {Vec3} pos
 * @param {Vec3[]} vertices
 * @returns {boolean}
 */
const isInsidePolygon = (pos, vertices) => {
	const [x, y] = pos;
	let inside = false;
	for (let i = 0, j = vertices.length - 1; i < vertices.length; j = i++) {
		const [xi, yi] = vertices[i];
		const [xj, yj] = vertices[j];
		const intersect = ((yi > y) !== (yj > y)) && (x < (xj - xi) * (y - yi) / (yj - yi) + xi);
		if (intersect) inside = !inside;
	}
	return inside;
};

class ScoreText extends G2 {
	constructor() {
		super();
		this.hitCount = 0;
		this.shotCount = 0;
		this.textHeight(.1);
		this.setColor([.8, 1, 1]);
		this.setFont('Arial');
		this.render = function () {
			this.text(`Hits/Shots: ${this.hitCount}/${this.shotCount}
Accuracy: ${((this.hitCount / this.shotCount) * 100).toFixed(2)}%`, 0, 0, 'center');
		};
	}
}

class InstructionsText extends G2 {
	constructor() {
		super(true);
		this.setColor([.8, 1, 1]);
		this.textHeight(.05);
		this.text('Target Practice Shooter', 0, 0, 'center');
		this.text(`Use the left controller to
drag the target area corner
spheres. Shoot with either
controller.`, 0, -.15, 'center');
	}
}

/** @param {Node} model */
export const init = async (model) => {
	class TargetArea {
		/**
		 * @param {number} z
		 * @param {number} scale
		 */
		constructor(z, scale) {
			this.cornerScale = scale;
			this.z = z;
			this.#createCorners(1);

			this.target = {
				scale: .1,
				pos: [0, 0, z],
				obj: model.add('sphere')
					.move([0, 0, z])
					.color('cyan')
					.scale(.1)
			};
		}

		/**
		 * @param {number} range 
		 */
		#createCorners(range) {
			/** @type {{ obj: Node, pos: [number, number, number] }[]} */
			this.corners = [];
			const points = [-range, range];
			for (const x of points)
				for (const y of points)
					this.corners.push({
						obj: model.add('sphere').move(x, y, this.z).scale(this.cornerScale),
						pos: [x, y, this.z]
					});
		}

		animate() {
			for (const corner of this.corners) {
				const pointOnBeam = lcb.projectOntoBeam(corner.pos);
				const isHit = cg.distance(pointOnBeam, corner.pos) < this.cornerScale;
				const isPressed = buttonState.left[0].pressed;

				if (isHit & isPressed) {
					corner.pos = [pointOnBeam[0], pointOnBeam[1], this.z];
					corner.obj.identity()
						.move(corner.pos)
						.scale(this.cornerScale);
				}

				corner.obj.color(isHit ? (isPressed ? [1, 0, 0] : [1, .5, .5]) : [1, 1, 1]);
			}
		}

		moveTarget() {
			// calculate bounding box
			let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
			for (const { pos: [x, y] } of this.corners) {
				if (x < minX) minX = x;
				if (x > maxX) maxX = x;
				if (y < minY) minY = y;
				if (y > maxY) maxY = y;
			}

			// generate new coordinates
			const cornerPositions = this.corners.map(c => c.pos.slice(0, 2));
			let newPos;
			do {
				const x = Math.random() * (maxX - minX) + minX;
				const y = Math.random() * (maxY - minY) + minY;
				newPos = [x, y, this.z];
			} while (!isInsidePolygon(newPos, cornerPositions));

			// move target
			this.target.obj.identity()
				.move(this.target.pos = newPos)
				.scale(this.target.scale);
		}
	}

	class Bullet {
		static RADIUS = .01;
		static MAX_DISTANCE = 10;
		static VELOCITY_MULTIPLIER = 0.1;

		/** @type {Set<Bullet>} */
		static SET = new Set;

		/**
		 * @param {Vec3} pos 
		 * @param {Vec3} vel 
		 */
		static create(pos, vel) {
			this.SET.add(
				new this(
					model.add('sphere').move(pos),
					pos,
					vel.map(x => x * this.VELOCITY_MULTIPLIER)
				)
			);
		}

		/**
		 * @param {Hand} hand 
		 */
		static createAtHand(hand) {
			Bullet.create(inputEvents.pos(hand), beamVector(hand));
		}

		/**
		 * @param {Node} obj 
		 * @param {Vec3} pos 
		 * @param {Vec3} vel 
		 */
		constructor(obj, pos, vel) {
			this.obj = obj;
			this.pos = pos;
			this.vel = vel;
		}

		nextPos() {
			return cg.add(this.pos, this.vel);
		}

		update() {
			this.obj.identity().move(this.pos = this.nextPos()).scale(Bullet.RADIUS);
		}

		delete() {
			model.remove(this.obj);
			Bullet.SET.delete(this);
		}

		isTooFar() {
			return isFartherThan(this.pos, Bullet.MAX_DISTANCE);
		}

		/** @param {Vec3} pos */
		distanceFrom(pos) {
			return cg.distance(this.pos, pos);
		}
	}

	/** @type {Set<Hand>} */
	const handsPressed = new Set;
	const addToHandsPressed = handsPressed.add.bind(handsPressed);
	const removeFromHandsPressed = handsPressed.delete.bind(handsPressed);

	inputEvents.onPress = (hand) => {
		Bullet.createAtHand(hand);
		++score.shotCount;
	};

	class SettingsPanel extends G2 {
		constructor() {
			super();
			this.width = this.getCanvas().width;
			this.height = this.getCanvas().height;

			this.render = function () {
				this.setColor([1, 1, 1]);
				this.fillRect(-1, .5, 2, 2, 0);

				this.setColor([0, 0, 0]);
				this.textHeight(.1);
				this.text('Fire Mode', 0, .95, 'center');
			};
		}

		addWidgets(obj) {
			this.addWidget(obj, 'button', 0, .8, [1, .5, .5], 'Semi-Automatic', () => {
				handsPressed.clear();
				inputEvents.onPress = (hand) => {
					Bullet.createAtHand(hand);
					++score.shotCount;
				};
			});

			this.addWidget(obj, 'button', 0, .6, [1, .5, .5], 'Automatic', () => {
				inputEvents.onPress = addToHandsPressed;
				inputEvents.onRelease = removeFromHandsPressed;
			});
		}
	}

	const targetArea = new TargetArea(-3, .05);

	const instructions = new InstructionsText;
	model.txtrSrc(8, instructions.getCanvas());
	model.add('square').txtr(8).identity().move(0, 2.5, targetArea.z);

	const score = new ScoreText;
	model.txtrSrc(9, score.getCanvas());
	model.add('square').txtr(9).identity().move(0, 1.5, targetArea.z);

	const settings = new SettingsPanel;
	model.txtrSrc(10, settings.getCanvas());
	settings.addWidgets(model.add('square').txtr(10).identity().move(-2, 0.5, targetArea.z));

	model.animate(() => {
		/* detect target area corner movement */
		targetArea.animate();

		/* automatic fire */
		handsPressed.forEach(Bullet.createAtHand);

		for (const bullet of Bullet.SET) {
			bullet.update();

			if (bullet.isTooFar()) {
				bullet.delete();
				continue;
			}

			if (bullet.distanceFrom(targetArea.target.pos) < targetArea.target.scale) {
				bullet.delete();
				targetArea.moveTarget();
				++score.hitCount;
			}
		}

		score.update();
		settings.update();
	});
};
