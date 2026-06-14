/// <reference path="../pb_data/types.d.ts" />
migrate((app) => {
  const collection = app.findCollectionByNameOrId("pbc_2320928750")

  // add field
  collection.fields.addAt(8, new Field({
    "hidden": false,
    "id": "json1488259346",
    "maxSize": 0,
    "name": "pb_schema",
    "presentable": false,
    "required": false,
    "system": false,
    "type": "json"
  }))

  return app.save(collection)
}, (app) => {
  const collection = app.findCollectionByNameOrId("pbc_2320928750")

  // remove field
  collection.fields.removeById("json1488259346")

  return app.save(collection)
})
