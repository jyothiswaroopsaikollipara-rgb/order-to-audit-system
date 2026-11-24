
export type SalesProduct = {
  id: string | number;
  sku: string;
  name: string;
  kind: string;
  unit: string;
  selling_price: string | null;
  gst_rate: string | null;
  units_per_carton: string | null;
};

export type SalesMasters = {
  items: SalesProduct[];
  customers: {
    id: string | number;
    name: string;
    state_code?: string;
  }[];
  boms: unknown[];
};

export type QueuedOrder = {
  requestKey: string;
  customerId: number;
  itemId: number;
  quantity: string;
  customerName: string;
  productName: string;
  createdAt: string;
  error?: string;
};

function storageKey(
  userId: string,
  type: 'queue' | 'masters'
) {
  return `order-audit:v1:${userId}:${type}`;
}

export function readQueue(userId: string): QueuedOrder[] {
  const raw = localStorage.getItem(
    storageKey(userId, 'queue')
  );

  return raw ? JSON.parse(raw) : [];
}

export function writeQueue(
  userId: string,
  queue: QueuedOrder[]
) {
  localStorage.setItem(
    storageKey(userId, 'queue'),
    JSON.stringify(queue)
  );
}

export function enqueueOrder(
  userId: string,
  order: QueuedOrder
) {
  const queue = readQueue(userId);

  if (!queue.some(
    item => item.requestKey === order.requestKey
  )) {
    queue.push(order);
    writeQueue(userId, queue);
  }

  return queue;
}

export function removeQueuedOrder(
  userId: string,
  requestKey: string
) {
  const queue = readQueue(userId).filter(
    item => item.requestKey !== requestKey
  );

  writeQueue(userId, queue);
  return queue;
}

export function markQueueError(
  userId: string,
  requestKey: string,
  error: string
) {
  const queue = readQueue(userId).map(
    item => item.requestKey === requestKey
      ? { ...item, error }
      : item
  );

  writeQueue(userId, queue);
  return queue;
}

export function cacheMasters(
  userId: string,
  masters: SalesMasters
) {
  localStorage.setItem(
    storageKey(userId, 'masters'),
    JSON.stringify(masters)
  );
}

export function readCachedMasters(
  userId: string
): SalesMasters | null {
  const raw = localStorage.getItem(
    storageKey(userId, 'masters')
  );

  return raw ? JSON.parse(raw) : null;
}
