"""Empreintes sha256 de chaque pt.py publie (b20) : la ronde d'un projet met a jour une
copie modifiee seulement si c'est une version publiee intacte, jamais une retouche.
A regenerer avant chaque release : `python3 .claude/hooks/pt_publies.py` (tags + pt.py courant)."""
PUBLIES = {
    "06eabcfb239749efc4907f6486bf3a5a0b3c6ed43efe989c61bbc80de7cb8b67",
    "07c1a40fb95d951619ce49b7509c42eac955cdf145c74e745dd8a0313e279d17",
    "0c4b30299a99c59db59032c163ee905aac7c50192b2e068cdb1f8374e0fe5a80",
    "104cedbe556197acf34789c0222fd7e006e13468c2de3a9f1c650e7323bf9b12",
    "2068f21a34e0dc481dfeb08c22c9702b0f103d35ecc0bbaab0e0650af54c4530",
    "2b828dc8db517c0a94e77780f60b7dd426c2c7fea3e312efa9e780f01e73d7b4",
    "2f123f154bcac00f0b57e9fd3c74031e0905abb3aa4bbc51ddf6c460976f92b6",
    "2f3c3c7c288ad99a539d21a3409afbeacb1c631fe16b78eed642a9e34f763a65",
    "3684b27d841c858209c60b57389a88e230b442bf7dec984ca0c9717113ff465a",
    "4bc3f570ba0f5bcb30195d002dbf97065ca967ceeed368cf297120cfa1c1e859",
    "4ececa831dc644faa4e85bb56c67c25702d535682b2cbad9df3b175ee823d6f7",
    "50c098d8442a759bec2876ece2344a8116510940e6a21c06c01c111eb0e42725",
    "5420f79c845b6b9c9e615707d0cda5825940edd37bb1286030219e11f938af55",
    "57edbeefb7b6cf1d333069bb775d2b116a38b9bcb5554d426a7664d20afbf9c5",
    "5bc087924918f7ffc12df8e45fd642a82c88b4185088cbfcaca42970be22eac7",
    "5f7f0e55e1207722e187590f4967ca20546cade850e5cf11f27ef0c8b477b794",
    "60c58ed55f64016580312fc7544e5ed2e9bcce5c4f8b1e1e4ef21771421924e1",
    "70edf553c6a6079fcba7b7cddb115e8626e0f7e97834c4fda88eee0b628af327",
    "75a8902550bde7580f44fc94d064a72ff702a7ae010d11c7ec4308ed09660ac1",
    "802d1a098436065268a5600c3d4257ddb196bc48a6fa637096757d6e77c343af",
    "8ca8a2f02e4b856083c2f46f9f45dabeae8ed2237b0ab50bf22b1968f927b9d3",
    "b6c82bd7eef9049091328eabbcbba5ad90ad327a2709f382c4ab4f841faf338d",
    "b8d988c73543dd4533b24be15a41e09b5697a01e1f2f7019e9e62eafd80b6806",
    "bb67b892b3568b6ead1466cf9ad2f356d0f322da68273c86baff00956780e0e3",
    "cc8da9dddd06041bc03a55020c4ed1cb6fc3a136d27c6828459988965ac79161",
    "dfcf971b1fba9ff2ebefcd2d6b8bde13f1a766affa740bf324afac0d3d192fef",
    "ea802f96d795049b985ed2bed1819856029db6b76ab785c0fa7cddebdeeabbca",
    "eec7a8fad7345b54053026146a27c9241200c9969ea7c0166160c2aca75101f0",
    "f3e7e4bc37b61df9d53af290b0731d27ccc19eac35392086954b23eb8b3ba1a8",
    "f4a14268f958ead9a95939cc8728d0deed415d840111b3803ab3c69485f801a7",
}

if __name__ == "__main__":
    import hashlib, os, subprocess
    ici = os.path.dirname(os.path.abspath(__file__))
    git = lambda *a: subprocess.run(["git", *a], cwd=ici, capture_output=True).stdout
    versions = [git("show", f"{t}:.claude/hooks/pt.py") for t in git("tag").decode().split()]
    versions.append(open(os.path.join(ici, "pt.py"), "rb").read())
    sha = sorted({hashlib.sha256(v).hexdigest() for v in versions if v})
    src = open(__file__, encoding="utf-8").read()
    debut = src.index("PUBLIES = ")
    corps = "PUBLIES = {\n" + "".join(f'    "{s}",\n' for s in sha) + "}"
    with open(__file__, "w", encoding="utf-8") as f:
        f.write(src[:debut] + corps + src[src.index("\n\nif __name__") :])
    print(f"{len(sha)} empreinte(s)")
