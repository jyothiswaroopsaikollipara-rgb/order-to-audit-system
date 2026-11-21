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
