import Decimal from 'decimal.js';
export const D=x=>new Decimal(x);
export const money=x=>D(x).toDecimalPlaces(2,Decimal.ROUND_HALF_UP).toFixed(2);
export const variance=(actual,planned)=>D(planned).isZero()?null:D(actual).minus(planned).div(planned).mul(100).toDecimalPlaces(2).toFixed(2);
export const tax=(qty,price,rate,intra)=>{
 const taxable=D(qty).mul(price).toDecimalPlaces(2,Decimal.ROUND_HALF_UP);
 const cgst=intra?taxable.mul(rate).div(200).toDecimalPlaces(2,Decimal.ROUND_HALF_UP):D(0);
 const sgst=intra?cgst:D(0);
 const igst=intra?D(0):taxable.mul(rate).div(100).toDecimalPlaces(2,Decimal.ROUND_HALF_UP);
 return {taxable:money(taxable),cgst:money(cgst),sgst:money(sgst),igst:money(igst),total:money(taxable.plus(cgst).plus(sgst).plus(igst))};
};

export function convertQuantity(
  quantity,
  fromUnit,
  toUnit,
  unitsPerCarton = null
) {
  const aliases = {
    gram: 'g',
    grams: 'g',
    kilogram: 'kg',
    kilograms: 'kg',
    liter: 'litre',
    liters: 'litre',
    litres: 'litre',
    l: 'litre',
    millilitre: 'ml',
    millilitres: 'ml',
    pieces: 'piece',
    pcs: 'piece',
    packets: 'packet',
    cartons: 'carton'
  };

  const normalize = unit => {
    const value = String(unit).trim().toLowerCase();
    return aliases[value] ?? value;
  };

  const from = normalize(fromUnit);
  const to = normalize(toUnit);
  const amount = D(quantity);

  if (!amount.isFinite() || amount.lt(0)) {
    throw new Error('Invalid quantity');
  }

  const groups = [
    { kg: 1000, g: 1 },
    { litre: 1000, ml: 1 }
  ];

  if (from === to) {
    return amount;
  }

  for (const group of groups) {
    if (
      Object.hasOwn(group, from) &&
      Object.hasOwn(group, to)
    ) {
      return amount.mul(group[from]).div(group[to]);
    }
  }

  if (unitsPerCarton != null) {
    const ratio = D(unitsPerCarton);

    if (ratio.isFinite() && ratio.gt(0)) {
      if (
        from === 'carton' &&
        ['piece', 'packet'].includes(to)
      ) {
        return amount.mul(ratio);
      }

      if (
        to === 'carton' &&
        ['piece', 'packet'].includes(from)
      ) {
        return amount.div(ratio);
      }
    }
  }

  throw new Error(
    `Unsupported conversion: ${from} to ${to}`
  );
}

export function varianceAlert(
  variancePct,
  tolerancePct = 3
) {
  if (variancePct == null) return false;

  return D(variancePct)
    .abs()
    .gt(tolerancePct);
}

export function productionMargin(
  materialCost,
  overhead,
  goodOutput,
  sellingPrice
) {
  const output = D(goodOutput);
  const price = D(sellingPrice);

  if (output.lte(0) || price.lte(0)) {
    throw new Error(
      'Output and selling price must be positive'
    );
  }

  const total = D(materialCost).plus(overhead);
  const costPerPacket = total.div(output);
  const profit = price.minus(costPerPacket);

  return {
    totalCost: money(total),
    costPerPacket: money(costPerPacket),
    sellingPrice: money(price),
    profitPerPacket: money(profit),
    marginPct: money(profit.div(price).mul(100))
  };
}

