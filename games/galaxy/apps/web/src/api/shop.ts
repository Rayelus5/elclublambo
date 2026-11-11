import type { ShopCheckout, ShopPurchaseView, ShopView, Wallet } from '@galaxy/shared';
import { type QueryClient, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from './client';
import { endIntent, GACHA_KEY, keyFor } from './economy';

// The resource shop as the client sees it (shop and lab plan, F5): its view (prices, what each product gives, the
// limits), opening a payment (one intent per product chosen: a lost answer reuses its key, so the same payment is
// found again instead of opening another), and a purchase's state, read until it is paid. Every number comes from the
// server.

export const SHOP_KEY = ['shop'] as const;
const PURCHASE_KEY = 'shop-purchase';

export function useShop() {
  return useQuery({ queryKey: SHOP_KEY, queryFn: () => api<ShopView>('/shop'), staleTime: 15_000 });
}

/** The wallet a delivered purchase left, everywhere a wallet is shown. */
export function settleWallet(qc: QueryClient, wallet: Wallet): void {
  for (const key of [GACHA_KEY, SHOP_KEY, ['station'], ['lab'], ['hangar']] as const) {
    qc.setQueryData<{ wallet?: Wallet }>(key, (old) => (old && typeof old === 'object' && 'wallet' in old ? { ...old, wallet } : old));
  }
}

const intent = (product: string) => `shop:${product}`;

/** Opens the payment of a product (the consent box ticked, the terms read). */
export function useCheckout() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ product, terms }: { product: string; terms: string }) =>
      api<ShopCheckout>('/shop/checkout', { method: 'POST', body: { product, consent: true, terms }, headers: keyFor(intent(product)) }),
    onSettled: (_res, error, { product }) => {
      endIntent(intent(product), error);
      // Limits, once-only products and the first-purchase extra changed.
      void qc.invalidateQueries({ queryKey: SHOP_KEY });
    },
  });
}

/** A purchase, read every 2 s while it may still be paid (the server asks Stripe itself when the webhook is late). */
export function usePurchase(id: string | null) {
  const qc = useQueryClient();
  return useQuery({
    queryKey: [PURCHASE_KEY, id],
    queryFn: async () => {
      const p = await api<ShopPurchaseView>(`/shop/purchases/${id}`);
      if (p.status === 'paid') {
        settleWallet(qc, p.wallet);
        void qc.invalidateQueries({ queryKey: SHOP_KEY });
      }
      return p;
    },
    enabled: id !== null,
    refetchInterval: (q) => (q.state.data && q.state.data.status !== 'pending' && q.state.data.status !== 'creating' ? false : 2_000),
  });
}
