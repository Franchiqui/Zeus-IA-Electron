/// <reference path="../pb_data/types.d.ts" />
migrate((app) => {
  const collection = app.findCollectionByNameOrId("6zsfy21nhwtnwma")

  // add field
  collection.fields.addAt(6, new Field({
    "hidden": false,
    "id": "bool1908663401",
    "name": "isEmbedding",
    "presentable": false,
    "required": false,
    "system": false,
    "type": "bool"
  }))

  return app.save(collection)
}, (app) => {
  const collection = app.findCollectionByNameOrId("6zsfy21nhwtnwma")

  // remove field
  collection.fields.removeById("bool1908663401")

  return app.save(collection)
})
