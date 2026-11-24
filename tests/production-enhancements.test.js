
import test from 'node:test';
import assert from 'node:assert/strict';

import {
  convertQuantity,
  varianceAlert,
  productionMargin
} from '../src/math.js';

test('grams to kilograms', () => {
  assert.equal(
    convertQuantity(40000, 'g', 'kg').toFixed(),
    '40'
  );
});

test('kilograms to grams', () => {
  assert.equal(
    convertQuantity(1.2, 'kg', 'g').toFixed(),
    '1200'
  );
});

test('millilitres to litres', () => {
  assert.equal(
    convertQuantity(10500, 'ml', 'litre').toFixed(),
    '10.5'
  );
});

test('same unit conversion', () => {
  assert.equal(
    convertQuantity(194, 'piece', 'piece').toFixed(),
    '194'
  );
});

test('configured carton conversion', () => {
  assert.equal(
    convertQuantity(2, 'carton', 'packet', 20).toFixed(),
    '40'
  );
});

test('carton conversion requires ratio', () => {
  assert.throws(
    () => convertQuantity(2, 'carton', 'packet')
  );
});

test('incompatible unit conversion rejected', () => {
  assert.throws(
    () => convertQuantity(10, 'kg', 'litre')
  );
});

test('negative quantity rejected', () => {
  assert.throws(
    () => convertQuantity(-1, 'kg', 'g')
  );
});

test('nonfinite quantity rejected', () => {
  assert.throws(
    () => convertQuantity('Infinity', 'kg', 'g')
  );
});

test('variance outside tolerance', () => {
  assert.equal(varianceAlert(-6, 3), true);
  assert.equal(varianceAlert(5, 3), true);
});

test('variance at tolerance boundary', () => {
  assert.equal(varianceAlert(-3, 3), false);
  assert.equal(varianceAlert(3, 3), false);
});

test('configurable variance tolerance', () => {
  assert.equal(varianceAlert(5, 6), false);
  assert.equal(varianceAlert(5, 2), true);
});

test('benchmark production margin', () => {
  const result = productionMargin(
    4055, 1800, 188, 50
  );

  assert.equal(result.totalCost, '5855.00');
  assert.equal(result.costPerPacket, '31.14');
  assert.equal(result.profitPerPacket, '18.86');
  assert.equal(result.marginPct, '37.71');
});

test('negative production margin', () => {
  const result = productionMargin(
    5000, 1000, 100, 50
  );

  assert.equal(result.profitPerPacket, '-10.00');
  assert.equal(result.marginPct, '-20.00');
});

test('zero production output rejected', () => {
  assert.throws(
    () => productionMargin(4055, 1800, 0, 50)
  );
});

test('gram purchase preserves total value', () => {
  const base = convertQuantity(60000, 'g', 'kg');
  const rate = convertQuantity('0.045', 'kg', 'g');

  assert.equal(base.toFixed(), '60');
  assert.equal(rate.toFixed(), '45');
  assert.equal(base.mul(rate).toFixed(2), '2700.00');
});

test('millilitre purchase preserves total value', () => {
  const base = convertQuantity(10000, 'ml', 'litre');
  const rate = convertQuantity('0.14', 'litre', 'ml');

  assert.equal(base.toFixed(), '10');
  assert.equal(rate.toFixed(), '140');
  assert.equal(base.mul(rate).toFixed(2), '1400.00');
});

test('carton purchase preserves total value', () => {
  const base = convertQuantity(
    2, 'carton', 'piece', 100
  );

  const rate = convertQuantity(
    250, 'piece', 'carton', 100
  );

  assert.equal(base.toFixed(), '200');
  assert.equal(rate.toFixed(), '2.5');
  assert.equal(base.mul(rate).toFixed(2), '500.00');
});

test('zero carton ratio is rejected', () => {
  assert.throws(
    () => convertQuantity(2, 'carton', 'piece', 0)
  );
});