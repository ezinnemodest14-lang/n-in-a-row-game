/**
 * neural-net.ts — pure TypeScript multi-layer perceptron (NO external ML
 * libraries, NO npm dependencies — only typed arrays + Math).
 *
 * Architecture (default): 40 → 128 (ReLU) → 64 (ReLU) → 1 (Sigmoid)
 *   = 40·128 + 128  +  128·64 + 64  +  64·1 + 1  = 13,569 parameters.
 *   (The rebuild plan quoted "~10,305 params"; the explicitly specified
 *   40→128→64→1 topology actually has 13,569 — the topology is authoritative.)
 *
 * Training: MSE loss, Adam optimizer (β1 = 0.9, β2 = 0.999, ε = 1e-8) with
 * bias correction. `trainBatch` performs one full-batch Adam step and returns
 * the mean MSE; `trainEpochs` wraps it with Fisher–Yates-shuffled mini-batches.
 *
 * Initialization: deterministic mulberry32-seeded PRNG.
 *   - He (normal, std = √(2/fanIn)) for ReLU hidden layers.
 *   - Xavier (normal, std = √(1/fanIn)) for the sigmoid output layer.
 *
 * Persistence: `serialize()` → plain JSON object (weights + Adam moments),
 * `NeuralNet.load(obj)` → reconstructs an equivalent network (validated).
 */

import { FEATURE_DIM } from './features';

/** Adam first-moment decay. */
export const ADAM_BETA1 = 0.9;
/** Adam second-moment decay. */
export const ADAM_BETA2 = 0.999;
/** Adam numerical-stability constant. */
export const ADAM_EPS = 1e-8;

/** Default topology: 40 inputs → 128 ReLU → 64 ReLU → 1 sigmoid output. */
export const DEFAULT_SIZES: readonly number[] = [FEATURE_DIM, 128, 64, 1];

/** Total trainable parameters (weights + biases) implied by a layer-size list. */
export function paramCount(sizes: readonly number[]): number {
  let total = 0;
  for (let l = 0; l + 1 < sizes.length; l++) total += sizes[l] * sizes[l + 1] + sizes[l + 1];
  return total;
}

/**
 * Deterministic 32-bit PRNG (mulberry32). Returns uniform floats in [0, 1).
 * Same seed ⇒ same sequence ⇒ reproducible initialization and shuffling.
 */
export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return function () {
    a = (a + 0x6d2b79f5) | 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * Box–Muller transform wrapped around a uniform PRNG → standard-normal sampler.
 * Caches the spare variate so every two uniforms yield exactly two normals
 * (keeps the stream deterministic and pairable with the raw PRNG).
 */
function gaussian(rng: () => number): () => number {
  let spare: number | null = null;
  return function () {
    if (spare !== null) {
      const s = spare;
      spare = null;
      return s;
    }
    let u = 0;
    let v = 0;
    let s = 0;
    do {
      u = rng() * 2 - 1;
      v = rng() * 2 - 1;
      s = u * u + v * v;
    } while (s === 0 || s >= 1);
    const factor = Math.sqrt((-2 * Math.log(s)) / s);
    spare = v * factor;
    return u * factor;
  };
}

/** Options for `trainEpochs` (shuffled mini-batch training). */
export interface TrainOptions {
  /** Number of passes over the dataset (default 1). */
  epochs?: number;
  /** Adam step size (default 0.005). */
  lr?: number;
  /** Mini-batch size (default 32). */
  batchSize?: number;
  /** Fisher–Yates shuffle the sample order every epoch (default true). */
  shuffle?: boolean;
}

/** Per-epoch summary produced by `trainEpochs`. */
export interface EpochReport {
  epoch: number;
  /** Mean MSE over the whole dataset for this epoch. */
  loss: number;
  /** Adam steps taken (number of mini-batches). */
  steps: number;
}

/** Loss + sign-accuracy over a labeled set. */
export interface EvalStats {
  loss: number;
  accuracy: number;
}

/** JSON-serializable snapshot of the network incl. optimizer moments. */
export interface SerializedNet {
  magic: 'nn-eval-v1';
  sizes: number[];
  /** Per layer: [fanOut][fanIn] weight matrices (row-major rows). */
  W: number[][][];
  /** Per layer: bias vectors. */
  b: number[][];
  adam: {
    mW: number[][][];
    vW: number[][][];
    mB: number[][];
    vB: number[][];
    t: number;
  };
}

const relu = (z: number): number => (z > 0 ? z : 0);

export class NeuralNet {
  /** Layer sizes, e.g. [40, 128, 64, 1]. */
  readonly sizes: number[];

  /** W[l] holds sizes[l+1]·sizes[l] weights, row-major: W[l][o * fanIn + i]. */
  private readonly W: Float64Array[] = [];
  private readonly b: Float64Array[] = [];
  // Adam first (m) and second (v) moment buffers, mirroring W/b.
  private readonly mW: Float64Array[] = [];
  private readonly vW: Float64Array[] = [];
  private readonly mB: Float64Array[] = [];
  private readonly vB: Float64Array[] = [];
  /** Adam timestep (bias-correction counter). */
  private t = 0;

  private rng: () => number;

  constructor(seed = 0x5eed, sizes: readonly number[] = DEFAULT_SIZES, initFromSeed = true) {
    if (sizes.length < 2) throw new Error('NeuralNet needs at least input + output layers');
    this.sizes = Array.from(sizes);
    this.rng = mulberry32(seed);

    for (let l = 0; l + 1 < this.sizes.length; l++) {
      const fanIn = this.sizes[l];
      const fanOut = this.sizes[l + 1];
      if (!(fanIn > 0) || !(fanOut > 0)) throw new Error(`invalid layer sizes at index ${l}`);

      const w = new Float64Array(fanIn * fanOut);
      if (initFromSeed) {
        const gauss = gaussian(this.rng);
        const isOutputLayer = l + 2 === this.sizes.length;
        // He init for ReLU layers, Xavier for the sigmoid output layer.
        const std = isOutputLayer ? Math.sqrt(1 / fanIn) : Math.sqrt(2 / fanIn);
        for (let i = 0; i < w.length; i++) w[i] = gauss() * std;
      }
      this.W.push(w);
      this.b.push(new Float64Array(fanOut));
      this.mW.push(new Float64Array(w.length));
      this.vW.push(new Float64Array(w.length));
      this.mB.push(new Float64Array(fanOut));
      this.vB.push(new Float64Array(fanOut));
    }
  }

  // ───────────────────────────── Forward pass ─────────────────────────────

  /**
   * Forward pass returning every layer's post-activation values:
   * acts[0] = input, acts[L] = single-element output (sigmoid prob).
   * ReLU derivatives are recovered in backprop from acts[i] > 0.
   */
  private forwardTrace(x: Float64Array): Float64Array[] {
    const L = this.W.length;
    const acts: Float64Array[] = new Array(L + 1);
    acts[0] = x;
    for (let l = 0; l < L; l++) {
      const W = this.W[l];
      const b = this.b[l];
      const inA = acts[l];
      const fanIn = this.sizes[l];
      const fanOut = this.sizes[l + 1];
      const out = new Float64Array(fanOut);
      const isOutputLayer = l + 1 === L;
      for (let o = 0; o < fanOut; o++) {
        let z = b[o];
        const rowBase = o * fanIn;
        for (let i = 0; i < fanIn; i++) z += W[rowBase + i] * inA[i];
        out[o] = isOutputLayer ? 1 / (1 + Math.exp(-z)) : relu(z);
      }
      acts[l + 1] = out;
    }
    return acts;
  }

  /**
   * Evaluate the network: returns the win probability for player 1 in [0, 1]
   * (sigmoid output). Throws if the input dimension mismatches.
   */
  forward(x: Float64Array): number {
    if (x.length !== this.sizes[0]) {
      throw new Error(`forward: expected input dim ${this.sizes[0]}, got ${x.length}`);
    }
    const acts = this.forwardTrace(x);
    return acts[acts.length - 1][0];
  }

  // ─────────────────────────── Backward pass ──────────────────────────────

  /**
   * Backprop one sample, accumulating mean-ready gradients into gW/gB.
   * Loss = (p − y)² ⇒ dL/dz_out = 2(p − y)·p·(1 − p) for the sigmoid output.
   * Returns the sample's squared error.
   */
  private accumulateGrads(
    x: Float64Array,
    y: number,
    gW: Float64Array[],
    gB: Float64Array[],
  ): number {
    const acts = this.forwardTrace(x);
    const out = acts[acts.length - 1][0];
    const L = this.W.length;

    let delta = new Float64Array([2 * (out - y) * out * (1 - out)]);

    for (let l = L - 1; l >= 0; l--) {
      const inA = acts[l];
      const fanIn = this.sizes[l];
      const fanOut = this.sizes[l + 1];
      const gWl = gW[l];
      const gBl = gB[l];

      for (let o = 0; o < fanOut; o++) {
        const d = delta[o];
        gBl[o] += d;
        const rowBase = o * fanIn;
        for (let i = 0; i < fanIn; i++) gWl[rowBase + i] += d * inA[i];
      }

      if (l > 0) {
        // Propagate through W[l] then through the ReLU of layer l.
        const W = this.W[l];
        const prevDelta = new Float64Array(fanIn);
        for (let i = 0; i < fanIn; i++) {
          let s = 0;
          for (let o = 0; o < fanOut; o++) s += W[o * fanIn + i] * delta[o];
          prevDelta[i] = inA[i] > 0 ? s : 0; // ReLU' from cached activation
        }
        delta = prevDelta;
      }
    }
    const diff = out - y;
    return diff * diff;
  }

  /** One Adam step using accumulated (already-meaned) gradients. */
  private applyAdam(gW: Float64Array[], gB: Float64Array[], lr: number): void {
    this.t++;
    const bc1 = 1 - Math.pow(ADAM_BETA1, this.t);
    const bc2 = 1 - Math.pow(ADAM_BETA2, this.t);
    for (let l = 0; l < this.W.length; l++) {
      const W = this.W[l];
      const b = this.b[l];
      const mW = this.mW[l];
      const vW = this.vW[l];
      const mB = this.mB[l];
      const vB = this.vB[l];
      const gWl = gW[l];
      const gBl = gB[l];
      for (let i = 0; i < W.length; i++) {
        const g = gWl[i];
        const m = (mW[i] = ADAM_BETA1 * mW[i] + (1 - ADAM_BETA1) * g);
        const v = (vW[i] = ADAM_BETA2 * vW[i] + (1 - ADAM_BETA2) * g * g);
        W[i] -= (lr * (m / bc1)) / (Math.sqrt(v / bc2) + ADAM_EPS);
      }
      for (let i = 0; i < b.length; i++) {
        const g = gBl[i];
        const m = (mB[i] = ADAM_BETA1 * mB[i] + (1 - ADAM_BETA1) * g);
        const v = (vB[i] = ADAM_BETA2 * vB[i] + (1 - ADAM_BETA2) * g * g);
        b[i] -= (lr * (m / bc1)) / (Math.sqrt(v / bc2) + ADAM_EPS);
      }
    }
  }

  /**
   * Full-batch training step: mean gradients over all samples, then one Adam
   * update. Returns the mean MSE loss across the batch (pre-update).
   */
  trainBatch(X: Float64Array[], y: number[], lr: number): number {
    if (X.length !== y.length) throw new Error('trainBatch: X/y length mismatch');
    if (X.length === 0) return 0;

    const gW = this.W.map((w) => new Float64Array(w.length));
    const gB = this.b.map((b) => new Float64Array(b.length));

    let lossSum = 0;
    for (let s = 0; s < X.length; s++) lossSum += this.accumulateGrads(X[s], y[s], gW, gB);

    const inv = 1 / X.length;
    for (let l = 0; l < gW.length; l++) {
      const gWl = gW[l];
      for (let i = 0; i < gWl.length; i++) gWl[i] *= inv;
      const gBl = gB[l];
      for (let i = 0; i < gBl.length; i++) gBl[i] *= inv;
    }
    this.applyAdam(gW, gB, lr);
    return lossSum * inv;
  }

  /**
   * Multi-epoch shuffled mini-batch training. Every epoch the sample order is
   * Fisher–Yates-shuffled (using the net's deterministic PRNG), then the set is
   * sliced into mini-batches of `batchSize`; each batch takes one Adam step via
   * `trainBatch`. Returns one report per epoch with the mean dataset loss.
   */
  trainEpochs(X: Float64Array[], y: number[], opts: TrainOptions = {}): EpochReport[] {
    if (X.length !== y.length) throw new Error('trainEpochs: X/y length mismatch');
    const epochs = Math.max(1, Math.floor(opts.epochs ?? 1));
    const lr = opts.lr ?? 0.005;
    const batchSize = Math.max(1, Math.floor(opts.batchSize ?? 32));
    const shuffle = opts.shuffle ?? true;

    const idx = new Int32Array(X.length);
    for (let i = 0; i < idx.length; i++) idx[i] = i;

    const reports: EpochReport[] = [];
    for (let e = 0; e < epochs; e++) {
      if (shuffle) {
        for (let i = idx.length - 1; i > 0; i--) {
          const j = Math.floor(this.rng() * (i + 1));
          const tmp = idx[i];
          idx[i] = idx[j];
          idx[j] = tmp;
        }
      }
      let lossSum = 0;
      let steps = 0;
      for (let start = 0; start < idx.length; start += batchSize) {
        const end = Math.min(start + batchSize, idx.length);
        const bx: Float64Array[] = new Array(end - start);
        const by: number[] = new Array(end - start);
        for (let k = start; k < end; k++) {
          bx[k - start] = X[idx[k]];
          by[k - start] = y[idx[k]];
        }
        lossSum += this.trainBatch(bx, by, lr) * bx.length;
        steps++;
      }
      reports.push({ epoch: e + 1, loss: X.length > 0 ? lossSum / X.length : 0, steps });
    }
    return reports;
  }

  /**
   * Loss + accuracy over a labeled set (no weight updates).
   * Accuracy = fraction where the prediction's sign around 0.5 agrees with the
   * outcome: label 1 ⇒ p > 0.5, label 0 ⇒ p < 0.5, label 0.5 (draw) ⇒ |p − 0.5|
   * within a ±0.15 tolerance band.
   */
  evaluate(X: Float64Array[], y: number[]): EvalStats {
    if (X.length !== y.length) throw new Error('evaluate: X/y length mismatch');
    if (X.length === 0) return { loss: 0, accuracy: 0 };
    let lossSum = 0;
    let correct = 0;
    for (let s = 0; s < X.length; s++) {
      const p = this.forward(X[s]);
      const diff = p - y[s];
      lossSum += diff * diff;
      const hit =
        y[s] === 0.5
          ? Math.abs(diff) <= 0.15
          : y[s] > 0.5
            ? p > 0.5
            : p < 0.5;
      if (hit) correct++;
    }
    return { loss: lossSum / X.length, accuracy: correct / X.length };
  }

  // ───────────────────────────── Persistence ──────────────────────────────

  /** Serialize weights + biases + Adam moments to a JSON-safe plain object. */
  serialize(): SerializedNet {
    const layers = this.W.length;
    const packRows = (src: Float64Array[]): number[][][] =>
      src.map((flat, l) => {
        const fanIn = this.sizes[l];
        const fanOut = this.sizes[l + 1];
        const rows: number[][] = [];
        for (let o = 0; o < fanOut; o++) {
          rows.push(Array.from(flat.subarray(o * fanIn, (o + 1) * fanIn)));
        }
        return rows;
      });
    return {
      magic: 'nn-eval-v1',
      sizes: this.sizes.slice(),
      W: packRows(this.W),
      b: this.b.map((v) => Array.from(v)),
      adam: {
        mW: packRows(this.mW),
        vW: packRows(this.vW),
        mB: this.mB.map((v) => Array.from(v)),
        vB: this.vB.map((v) => Array.from(v)),
        t: this.t,
      },
    };
  }

  /** Rebuild a network from `serialize()` output (validates shape + magic). */
  static load(obj: unknown): NeuralNet {
    if (!obj || typeof obj !== 'object') throw new Error('load: payload is not an object');
    const data = obj as Partial<SerializedNet>;
    if (data.magic !== 'nn-eval-v1') throw new Error('load: bad magic field');
    if (!Array.isArray(data.sizes) || data.sizes.length < 2) throw new Error('load: bad sizes');
    const sizes = data.sizes.map(Number);
    if (sizes.some((s) => !(s > 0))) throw new Error('load: non-positive layer size');
    if (!Array.isArray(data.W) || data.W.length !== sizes.length - 1) {
      throw new Error('load: weight layer count mismatch');
    }
    if (!Array.isArray(data.b) || data.b.length !== sizes.length - 1) {
      throw new Error('load: bias layer count mismatch');
    }
    const adam = (data.adam ?? {}) as Partial<SerializedNet['adam']>;

    // Construct without seeded init, then overwrite every trainable value.
    const net = new NeuralNet(0, sizes, false);
    for (let l = 0; l + 1 < sizes.length; l++) {
      const fanIn = sizes[l];
      const fanOut = sizes[l + 1];
      const wRows: number[][] = data.W[l];
      const bArr: number[] = data.b[l];
      if (!Array.isArray(wRows) || wRows.length !== fanOut || !Array.isArray(bArr) || bArr.length !== fanOut) {
        throw new Error(`load: layer ${l} shape mismatch`);
      }
      const W = net.W[l];
      const b = net.b[l];
      const mW = net.mW[l];
      const vW = net.vW[l];
      const mB = net.mB[l];
      const vB = net.vB[l];
      const mRows = adam.mW?.[l];
      const vRows = adam.vW?.[l];
      const mbArr = adam.mB?.[l];
      const vbArr = adam.vB?.[l];
      for (let o = 0; o < fanOut; o++) {
        const row: number[] = wRows[o];
        if (!Array.isArray(row) || row.length !== fanIn) {
          throw new Error(`load: layer ${l} row ${o} shape mismatch`);
        }
        const base: number = o * fanIn;
        for (let i = 0; i < fanIn; i++) {
          const k = base + i;
          W[k] = Number(row[i]);
          mW[k] = mRows?.[o]?.[i] !== undefined ? Number(mRows[o][i]) : 0;
          vW[k] = vRows?.[o]?.[i] !== undefined ? Number(vRows[o][i]) : 0;
        }
        b[o] = Number(bArr[o]);
        mB[o] = mbArr?.[o] !== undefined ? Number(mbArr[o]) : 0;
        vB[o] = vbArr?.[o] !== undefined ? Number(vbArr[o]) : 0;
      }
    }
    net.t = typeof adam.t === 'number' ? adam.t : 0;
    return net;
  }
}
