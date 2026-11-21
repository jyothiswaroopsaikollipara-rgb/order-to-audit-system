"""Executable, deterministic benchmark model; NOT a substitute for database integration tests."""
from decimal import Decimal, ROUND_HALF_UP
from dataclasses import dataclass, field

D = lambda x: Decimal(str(x))

def money(x):
    return D(x).quantize(D('0.01'), rounding=ROUND_HALF_UP)

@dataclass
class Benchmark:
    stock: dict = field(default_factory=lambda: {'flour': D(100), 'oil': D(30), 'spice': D(5), 'pouch': D(500), 'carton': D(30), 'murukku': D(50)})
    ledger: list = field(default_factory=list)
    # Weighted average of opening flour and newly purchased flour.
    flour_value: Decimal = D(100) * D(42)
    flour_quantity: Decimal = D(100)
    issued_cost: Decimal = D(0)
    good_output: Decimal = D(0)
    invoice_total: Decimal = D(0)
    payments: Decimal = D(0)

    def move(self, item, qty, source):
        qty = D(qty)
        after = self.stock[item] + qty
        if after < 0:
            raise ValueError(f'insufficient {item}: shortage {-after}')
        self.stock[item] = after
        self.ledger.append((source, item, qty))

    def purchase_flour(self):
        self.move('flour', 60, 'PURCHASE:1')
        self.flour_value += D(60) * D(45)
        self.flour_quantity += D(60)

    def produce(self):
        avg_flour = self.flour_value / self.flour_quantity
        consumption = {'flour': D(40), 'oil': D('10.5'), 'spice': D('1.2'), 'pouch': D(194), 'carton': D(9)}
        rates = {'flour': avg_flour, 'oil': D(140), 'spice': D(200), 'pouch': D('2.5'), 'carton': D(15)}
        for item, qty in consumption.items():
            self.move(item, -qty, 'PRODUCTION:1')
            self.issued_cost += qty * rates[item]
        self.flour_quantity -= D(40)
        self.flour_value -= D(40) * avg_flour
        self.good_output = D(188)
        self.move('murukku', self.good_output, 'PRODUCTION_OUTPUT:1')

    def invoice_and_dispatch(self):
        qty, price = D(150), D(50)
        taxable = qty * price
        cgst = money(taxable * D('0.025'))
        sgst = money(taxable * D('0.025'))
        self.invoice_total = taxable + cgst + sgst
        self.move('murukku', -qty, 'DISPATCH:1')
        return {'taxable': taxable, 'cgst': cgst, 'sgst': sgst, 'total': self.invoice_total}

    def distributor_shortage(self):
        return max(D(0), D(120) - self.stock['murukku'])

    def pay(self):
        self.payments += D(4000)

    def result(self):
        return {'stock': self.stock, 'yield_variance_pct': (self.good_output - D(200)) / D(200) * 100,
                'oil_variance_pct': (D('10.5') - D(10)) / D(10) * 100,
                'outstanding': self.invoice_total - self.payments,
                'cost_per_packet': money((self.issued_cost + D(1200) + D(600)) / self.good_output),
                'total_run_cost': money(self.issued_cost + D(1800))}

def run_benchmark():
    b = Benchmark()
    b.purchase_flour()
    b.produce()
    before_dispatch = b.stock['murukku']
    invoice = b.invoice_and_dispatch()
    shortage = b.distributor_shortage()
    b.pay()
    return b, before_dispatch, invoice, shortage

if __name__ == '__main__':
    b, before, invoice, shortage = run_benchmark()
    print('After production finished packets:', before)
    print('Invoice:', invoice)
    print('Distributor shortage:', shortage)
    print('Results:', b.result())
