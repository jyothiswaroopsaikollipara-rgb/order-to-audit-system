
import {
  useCallback,
  useEffect,
  useRef,
  useState
} from 'react';

import type { FormEvent } from 'react';

import {
  Wifi,
  WifiOff,
  RefreshCw,
  ShoppingCart
} from 'lucide-react';

import {
  readQueue,
  enqueueOrder,
  removeQueuedOrder,
  markQueueError,
  cacheMasters,
  readCachedMasters
} from './offlineOrders';

import type {
  QueuedOrder,
  SalesMasters
} from './offlineOrders';

import './MobileOrderEntry.css';

type Props = {
  token: string;
  userId: string;
  onUnauthorized: () => void;
};

function money(value: number) {
  return new Intl.NumberFormat('en-IN', {
    style: 'currency',
    currency: 'INR'
  }).format(value);
}

export default function MobileOrderEntry({
  token,
  userId,
  onUnauthorized
}: Props) {

  const [masters, setMasters] =
    useState<SalesMasters | null>(
      () => readCachedMasters(userId)
    );

  const [queue, setQueue] =
    useState<QueuedOrder[]>(
      () => readQueue(userId)
    );

  const [online, setOnline] =
    useState(navigator.onLine);

  const [customerId, setCustomerId] =
    useState('');

  const [itemId, setItemId] = useState('');
  const [quantity, setQuantity] = useState('');
  const [unit, setUnit] = useState('');

  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');

  const [syncing, setSyncing] = useState(false);
  const [cached, setCached] = useState(true);

  const syncLock = useRef(false);

  const products = masters?.items.filter(
    item => item.kind === 'FINISHED'
  ) ?? [];

  const selected = products.find(
    item => String(item.id) === itemId
  );

  const ratio = Number(
    selected?.units_per_carton ?? 0
  );

  const canUseCarton =
    !!selected &&
    ['piece', 'packet', 'pieces', 'packets', 'pcs']
      .includes(selected.unit.toLowerCase()) &&
    Number.isInteger(ratio) &&
    ratio > 0;

  const enteredQuantity = Number(quantity);

  const baseQuantity =
    unit === 'carton' &&
    selected?.unit !== 'carton'
      ? enteredQuantity * ratio
      : enteredQuantity;

  const price = Number(
    selected?.selling_price ?? 0
  );

  const gstRate = Number(
    selected?.gst_rate ?? 0
  );

  const discrete = [
    'piece', 'pieces', 'packet',
    'packets', 'carton', 'cartons', 'pcs'
  ].includes(
    selected?.unit.toLowerCase() ?? ''
  );

  const validQuantity =
    Number.isFinite(baseQuantity) &&
    baseQuantity > 0 &&
    baseQuantity <= 99999999999999 &&
    (!discrete || Number.isSafeInteger(baseQuantity)) &&
    (unit !== 'carton' ||
      Number.isSafeInteger(enteredQuantity));

  const taxable =
    validQuantity ? baseQuantity * price : 0;

  const gst = taxable * gstRate / 100;

  const refreshMasters = useCallback(async () => {
    try {
      const response = await fetch('/api/masters', {
        headers: {
          Authorization: `Bearer ${token}`
        }
      });

      if (response.status === 401) {
        onUnauthorized();
        return;
      }

      if (!response.ok) {
        throw new Error('Price list unavailable');
      }

      const data: SalesMasters =
        await response.json();

      cacheMasters(userId, data);
      setMasters(data);
      setCached(false);

    } catch {
      setCached(true);
    }
  }, [token, userId, onUnauthorized]);

  const synchronize = useCallback(async () => {
    if (!navigator.onLine || syncLock.current) {
      return;
    }

    syncLock.current = true;
    setSyncing(true);

    try {
      const pending = readQueue(userId).filter(
        order => !order.error
        );

      for (const order of pending) {
        let response: Response;

        try {
          response = await fetch('/api/orders', {
            method: 'POST',
            headers: {
              Authorization: `Bearer ${token}`,
              'Content-Type': 'application/json'
            },
            body: JSON.stringify({
              requestKey: order.requestKey,
              customerId: order.customerId,
              itemId: order.itemId,
              quantity: order.quantity
            })
          });
        } catch {
          setError(
            'Connection unavailable. Orders remain saved locally.'
          );
          break;
        }

        if (response.status === 401) {
          onUnauthorized();
          break;
        }

        if (response.ok) {
          const result = await response.json();

          setQueue(
            removeQueuedOrder(
              userId,
              order.requestKey
            )
          );

          setSuccess(
            `Order #${result.id} synchronized successfully.`
          );

          continue;
        }

        if (
          response.status >= 500 ||
          response.status === 429
        ) {
          setError(
            'Server temporarily unavailable. Retry synchronization.'
          );
          break;
        }

        const body = await response.json()
          .catch(() => null);

        setQueue(
          markQueueError(
            userId,
            order.requestKey,
            body?.error ??
              `Submission failed (${response.status})`
          )
        );
      }

    } catch {
      setError(
        'Synchronization failed. Check local storage and retry.'
      );
    } finally {
      syncLock.current = false;
      setSyncing(false);
    }
  }, [token, userId, onUnauthorized]);

  useEffect(() => {
    let active = true;

    function reconnect() {
      setOnline(true);
      void refreshMasters();
      void synchronize();
    }

    function disconnect() {
      setOnline(false);
      setCached(true);
    }

    window.addEventListener('online', reconnect);
    window.addEventListener('offline', disconnect);
    //window.clearInterval(retryTimer);
    // Schedule initialization after the effect body.
    void Promise.resolve().then(() => {
      if (active && navigator.onLine) {
        void refreshMasters();
        void synchronize();
      }
    });

    const retryTimer = window.setInterval(() => {
  if (
    navigator.onLine &&
    !syncLock.current &&
    readQueue(userId).some(order => !order.error)
  ) {
    void synchronize();
  }
}, 30000);

    return () => {
      active = false;
      window.removeEventListener('online', reconnect);
      window.removeEventListener('offline', disconnect);
      window.clearInterval(retryTimer);
    };
  }, [refreshMasters, synchronize,userId]);

  async function submit(event: FormEvent) {
    event.preventDefault();

    setError('');
    setSuccess('');

    const customer = masters?.customers.find(
      item => String(item.id) === customerId
    );

    if (
      !customer ||
      !selected ||
      !validQuantity ||
      price <= 0 || Number(baseQuantity.toFixed(4)) === baseQuantity &&
      syncing
    ) {
      setError(
        'Select a customer, product and valid quantity.'
      );
      return;
    }

    if (
      unit !== selected.unit &&
      !(unit === 'carton' && canUseCarton)
    ) {
      setError('Invalid ordering unit.');
      return;
    }

    const normalized = baseQuantity.toFixed(4);

    const order: QueuedOrder = {
      requestKey: crypto.randomUUID(),
      customerId: Number(customerId),
      itemId: Number(itemId),
      quantity: normalized,
      customerName: customer.name,
      productName: selected.name,
      createdAt: new Date().toISOString()
    };

    try {
      // Persist first, then attempt submission.
      setQueue(enqueueOrder(userId, order));
      setQuantity('');

      setSuccess(
        online
          ? 'Order saved. Synchronizing...'
          : 'Order saved offline. Awaiting synchronization.'
      );

      if (navigator.onLine) {
        await synchronize();
      }
    } catch {
      setError(
        'Unable to save the order locally. Order not confirmed.'
      );
    }
  }

  return (
    <div className="mobile-order-page">

      <section className="panel">
        <div className="panel-heading">
          <h2>Create sales order</h2>

          <span className={
            online
              ? 'connection-online'
              : 'connection-offline'
          }>
            {online
              ? <Wifi size={17}/>
              : <WifiOff size={17}/>}
            {online ? 'Online' : 'Offline'}
          </span>
        </div>

        <p className="muted">
          Orders require Admin approval.
          Stock is checked during approval.
        </p>

        {cached && masters && (
          <p className="offline-notice">
            Using cached customer and product data.
            Prices may have changed.
          </p>
        )}

        {error && (
          <p className="error" role="alert">
            {error}
          </p>
        )}

        {success && (
          <p className="success" role="status">
            {success}
          </p>
        )}

        {!masters ? (
          <p className="muted">
            Connect to the server to download
            the customer and product list.
          </p>
        ) : (
          <form
            className="business-form mobile-sales-form"
            onSubmit={submit}
          >
            <label htmlFor="sales-customer">
              Customer
            </label>

            <select
              id="sales-customer"
              value={customerId}
              onChange={e =>
                setCustomerId(e.target.value)
              }
              required
            >
              <option value="">
                Select customer
              </option>

              {masters.customers.map(customer => (
                <option
                  key={customer.id}
                  value={customer.id}
                >
                  {customer.name}
                </option>
              ))}
            </select>

            <label htmlFor="sales-product">
              Finished product
            </label>

            <select
              id="sales-product"
              value={itemId}
              onChange={e => {
                const value = e.target.value;
                const product = products.find(
                  item => String(item.id) === value
                );

                setItemId(value);
                setUnit(product?.unit ?? '');
                setQuantity('');
              }}
              required
            >
              <option value="">
                Select product
              </option>

              {products.map(product => (
                <option
                  key={product.id}
                  value={product.id}
                >
                  {product.name} — {
                    money(Number(product.selling_price))
                  }
                </option>
              ))}
            </select>

            {selected && (
              <>
                <div className="sales-product-info">
                  <strong>{selected.name}</strong>
                  <span>{selected.sku}</span>
                  <strong>
                    {money(price)} / {selected.unit}
                  </strong>
                  <span>GST: {gstRate}%</span>
                </div>

                <label htmlFor="sales-unit">
                  Ordering unit
                </label>

                <select
                  id="sales-unit"
                  value={unit}
                  onChange={e => {
                    setUnit(e.target.value);
                    setQuantity('');
                  }}
                >
                  <option value={selected.unit}>
                    {selected.unit}
                  </option>

                  {canUseCarton && (
                    <option value="carton">
                      Carton ({ratio} {selected.unit}s)
                    </option>
                  )}
                </select>

                <label htmlFor="sales-quantity">
                  Quantity
                </label>

                <input
                  id="sales-quantity"
                  type="number"
                  inputMode="decimal"
                  min={
                    discrete || unit === 'carton'
                      ? '1'
                      : '0.0001'
                  }
                  step={
                    discrete || unit === 'carton'
                      ? '1'
                      : '0.0001'
                  }
                  value={quantity}
                  onChange={e =>
                    setQuantity(e.target.value)
                  }
                  required
                  placeholder="Enter quantity"
                />

                <div className="sales-estimate">
                  <div>
                    <span>Base quantity</span>
                    <strong>
                      {validQuantity
                        ? baseQuantity
                        : 0} {selected.unit}
                    </strong>
                  </div>

                  <div>
                    <span>Taxable value</span>
                    <strong>{money(taxable)}</strong>
                  </div>

                  <div>
                    <span>Estimated GST</span>
                    <strong>{money(gst)}</strong>
                  </div>

                  <div className="sales-total">
                    <span>Estimated total</span>
                    <strong>
                      {money(taxable + gst)}
                    </strong>
                  </div>
                </div>

                <p className="muted">
                  Final pricing is subject to
                  Admin approval.
                </p>
              </>
            )}

            <button
              className="primary sales-submit"
              disabled={
                syncing ||
                !customerId ||
                !selected ||
                !validQuantity ||
                price <= 0
              }
            >
              <ShoppingCart size={18}/>

              {syncing
                ? 'Synchronizing...'
                : online
                  ? 'Submit order'
                  : 'Save order offline'}
            </button>
          </form>
        )}
      </section>

      <section className="panel">
        <div className="panel-heading">
          <h2>Product price list</h2>

          <button
            className="secondary"
            disabled={!online}
            onClick={() => void refreshMasters()}
          >
            <RefreshCw size={16}/> Refresh
          </button>
        </div>

        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Product</th>
                <th>SKU</th>
                <th>Unit</th>
                <th>Price</th>
                <th>GST</th>
                <th>Units / carton</th>
              </tr>
            </thead>

            <tbody>
              {products.map(product => (
                <tr key={product.id}>
                  <td>{product.name}</td>
                  <td>{product.sku}</td>
                  <td>{product.unit}</td>
                  <td>
                    {product.selling_price == null
                      ? 'Not configured'
                      : money(Number(product.selling_price))}
                  </td>
                  <td>{product.gst_rate ?? '—'}%</td>
                  <td>
                    {product.units_per_carton ??
                      'Not configured'}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <section className="panel">
        <div className="panel-heading">
          <h2>Pending synchronization ({queue.length})</h2>

          <button
            className="secondary"
            disabled={
              syncing || !online || !queue.length
            }
            onClick={() => {
  for (const order of readQueue(userId)) {
    if (order.error) {
      markQueueError(
        userId,
        order.requestKey,
        ''
      );
    }
  }

  setQueue(readQueue(userId));
  void synchronize();
}}
          >
            <RefreshCw size={16}/>

            {syncing
              ? 'Synchronizing...'
              : 'Sync now'}
          </button>
        </div>

        {!queue.length ? (
          <p className="muted">
            No pending offline orders.
          </p>
        ) : (
          <div className="offline-queue">
            {queue.map(order => (
              <article
                className="queued-order"
                key={order.requestKey}
              >
                <strong>{order.customerName}</strong>

                <span>{order.productName}</span>

                <span>
                  Base quantity: {order.quantity}
                </span>

                <small>
                  {new Date(order.createdAt)
                    .toLocaleString('en-IN')}
                </small>

                {order.error ? (
                  <p className="error">
                    {order.error}
                  </p>
                ) : (
                  <span className="connection-offline">
                    Pending synchronization
                  </span>
                )}
              </article>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}
