/// <reference path="../pb_data/types.d.ts" />
migrate((app) => {
  const collection = app.findCollectionByNameOrId("pbc_1505971473")

  // add field
  collection.fields.addAt(5, new Field({
    "hidden": false,
    "id": "bool4113625128",
    "name": "icon_lucide",
    "presentable": false,
    "required": false,
    "system": false,
    "type": "bool"
  }))

  return app.save(collection)
}, (app) => {
  const collection = app.findCollectionByNameOrId("pbc_1505971473")

  // remove field
  collection.fields.removeById("bool4113625128")

  return app.save(collection)
})
