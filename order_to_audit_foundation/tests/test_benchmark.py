import unittest
from decimal import Decimal as D
from benchmark import Benchmark, run_benchmark

class TestBenchmark(unittest.TestCase):
    def test_exact_benchmark(self):
        b, before, invoice, shortage = run_benchmark()
        self.assertEqual(before, D(238))
        for item, expected in {'flour':'120','oil':'19.5','pouch':'306','murukku':'88','spice':'3.8','carton':'21'}.items():
            self.assertEqual(b.stock[item], D(expected), item)
        self.assertEqual(invoice, {'taxable':D(7500),'cgst':D('187.50'),'sgst':D('187.50'),'total':D('7875.00')})
        self.assertEqual(shortage, D(32))
        self.assertEqual(b.result()['outstanding'], D(3875))
        self.assertEqual(b.result()['yield_variance_pct'], D(-6))
        self.assertEqual(b.result()['oil_variance_pct'], D(5))
        self.assertEqual(b.result()['cost_per_packet'], D('31.14'))
    def test_negative_stock_rejected_without_mutation(self):
        b = Benchmark()
        with self.assertRaises(ValueError): b.move('murukku', -51, 'DISPATCH:INVALID')
        self.assertEqual(b.stock['murukku'], D(50))
        self.assertEqual(len(b.ledger), 0)
    def test_source_traceability(self):
        b, _, _, _ = run_benchmark()
        self.assertTrue(all(source and item and qty for source,item,qty in b.ledger))
        self.assertEqual(len(b.ledger), 8)

if __name__ == '__main__': unittest.main()
