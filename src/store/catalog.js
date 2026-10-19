// The llama store. The client's store reads the CardPackStore and CardPackStorePromo storefronts (FortStorefront);
// each offer is FCatalogOffer, its card pack art and featured items coming from metaAssetInfo FortCatalogMeta
// {chaseItems, packDefinition}. What is on sale and for how much is Core's choice: the Upgrade Llama for 50 V-Bucks.
const offers = [
  {
    offerId: "core_cardpack_bronze",
    templateId: "CardPack:cardpack_bronze",
    packDefinition: "/Game/Items/CardPacks/CardPack_Bronze.CardPack_Bronze",
    title: "Upgrade Llama",
    price: 50
  }
];

function offerJson({ offerId, templateId, packDefinition, title, price }, sortPriority) {
  return {
    offerId,
    offerType: "StaticPrice",
    prices: [{ currencyType: "MtxCurrency", currencySubType: "", regularPrice: price, finalPrice: price, saleType: "NotOnSale",
      saleExpiration: "9999-12-31T23:59:59.999Z" }],
    metaInfo: [],
    dailyLimit: -1,
    weeklyLimit: -1,
    categories: [],
    catalogGroup: "",
    catalogGroupPriority: 0,
    sortPriority,
    title,
    shortDescription: "",
    description: "",
    appStoreId: "",
    metaAssetInfo: { structName: "FortCatalogMeta", payload: { chaseItems: [], packDefinition } },
    displayAssetPath: "",
    itemGrants: [{ templateId, quantity: 1 }],
    requirements: [],
    denyItemTemplateIds: []
  };
}

export function storefronts() {
  return [
    { name: "CardPackStore", catalogEntries: offers.map((offer, index) => offerJson(offer, -index)) },
    { name: "CardPackStorePromo", catalogEntries: [] }
  ];
}

export const findOffer = (offerId) => offers.find((offer) => offer.offerId === offerId);
