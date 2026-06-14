/// <reference path="../pb_data/types.d.ts" />
migrate((app) => {
  const collection = app.findCollectionByNameOrId("6zsfy21nhwtnwma")

  // add field
  collection.fields.addAt(11, new Field({
    "hidden": false,
    "id": "bool4041850396",
    "name": "stream",
    "presentable": false,
    "required": false,
    "system": false,
    "type": "bool"
  }))

  return app.save(collection)
}, (app) => {
  const collection = app.findCollectionByNameOrId("6zsfy21nhwtnwma")

  // remove field
  collection.fields.removeById("bool4041850396")

  return app.save(collection)
})
