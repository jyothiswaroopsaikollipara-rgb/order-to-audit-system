import test from 'node:test';import assert from 'node:assert/strict';import {D,money,variance,tax} from '../src/math.js';
test('benchmark GST split',()=>assert.deepEqual(tax('150','50','5',true),{taxable:'7500.00',cgst:'187.50',sgst:'187.50',igst:'0.00',total:'7875.00'}));
test('interstate GST',()=>assert.deepEqual(tax('120','50','5',false),{taxable:'6000.00',cgst:'0.00',sgst:'0.00',igst:'300.00',total:'6300.00'}));
test('benchmark yield and oil variance',()=>{assert.equal(variance('188','200'),'-6.00');assert.equal(variance('10.5','10'),'5.00');});
test('weighted average benchmark cost',()=>{const flour=D(100).mul(42).plus(D(60).mul(45)).div(160).mul(40);const total=flour.plus(D('10.5').mul(140)).plus(D('1.2').mul(200)).plus(D(194).mul('2.5')).plus(D(9).mul(15)).plus(1200).plus(600);assert.equal(money(total),'5855.00');assert.equal(money(total.div(188)),'31.14');});
