/// <reference path="../pb_data/types.d.ts" />
migrate((app) => {
  const collection = app.findCollectionByNameOrId("pbc_2249708725")

  // remove field
  collection.fields.removeById("relation1765873913")

  return app.save(collection)
}, (app) => {
  const collection = app.findCollectionByNameOrId("pbc_2249708725")

  // add field
  collection.fields.addAt(9, new Field({
    "cascadeDelete": false,
    "collectionId": "pbc_2347869979",
    "hidden": false,
    "id": "relation1765873913",
    "maxSelect": 1,
    "minSelect": 0,
    "name": "price_model_zeus",
    "presentable": false,
    "required": false,
    "system": false,
    "type": "relation"
  }))

  return app.save(collection)
})
