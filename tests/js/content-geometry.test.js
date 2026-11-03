import test from 'node:test';
import assert from 'node:assert/strict';
import {imageGeometry, projectBox, isEligibleImage, isCurrentRequest} from '../../extension/content/geometry.js';

test('contain letterboxes original image coordinates', () => {
  const geometry = imageGeometry(400, 400, 800, 400, 'contain');
  assert.deepEqual(projectBox({x: 80, y: 40, width: 160, height: 80}, geometry), {x: 40, y: 120, width: 80, height: 40});
});
test('cover clips regions rather than painting outside image', () => {
  const geometry = imageGeometry(200, 400, 400, 400, 'cover');
  assert.deepEqual(projectBox({x: 50, y: 10, width: 100, height: 80}, geometry), {x: 0, y: 10, width: 50, height: 80});
  assert.equal(projectBox({x: 0, y: 10, width: 50, height: 80}, geometry), null);
});
test('object position and independent fill scaling', () => {
  assert.deepEqual(imageGeometry(400, 400, 800, 400, 'contain', 'right bottom'), {scaleX: .5, scaleY: .5, x: 0, y: 200, width: 400, height: 400});
  assert.equal(imageGeometry(100, 100, 10, 10, 'scale-down').scaleX, 1);
  assert.equal(imageGeometry(200, 400, 400, 400).scaleY, 1);
  assert.equal(imageGeometry(0, 400, 400, 400), null);
  assert.equal(projectBox({x: NaN, y: 0, width: 1, height: 1}, {}), null);
});
test('eligibility requires loaded connected static image with both dimensions >=160', () => {
  const image = {isConnected: true, complete: true, naturalWidth: 160, naturalHeight: 160, currentSrc: 'https://example.test/page.png'};
  assert.equal(isEligibleImage(image), true);
  for (const patch of [{naturalWidth: 159}, {naturalHeight: 159}, {complete: false}, {isConnected: false}, {currentSrc: ''}]) assert.equal(isEligibleImage({...image, ...patch}), false);
});
test('late results are rejected after removal, cancel, disable, source change or navigation', () => {
  const snapshot = {requestId: 'r1', sourceVersion: 's1', imageUrl: 'https://example.test/1.png', pageUrl: 'https://example.test/chapter1'};
  const current = {...snapshot, enabled: true, connected: true};
  assert.equal(isCurrentRequest(snapshot, current), true);
  for (const patch of [{enabled: false}, {connected: false}, {requestId: null}, {sourceVersion: 's2'}, {imageUrl: 'https://example.test/2.png'}, {pageUrl: 'https://example.test/chapter2'}]) assert.equal(isCurrentRequest(snapshot, {...current, ...patch}), false);
});
