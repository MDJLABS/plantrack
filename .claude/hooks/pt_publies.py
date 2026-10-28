"""Empreintes sha256 de chaque pt.py publie (b20) : la ronde d'un projet met a jour une
copie modifiee seulement si c'est une version publiee intacte, jamais une retouche.
GUIDE_PUBLIES : idem pour chaque fichier du moteur de guide (b24) — un site qui a retouche le sien est laisse tel quel.
A regenerer avant chaque release : `python3 .claude/hooks/pt_publies.py` (tags + pt.py courant)."""
PUBLIES = {
    "01180bfed044008c6cf488b648db9fed5a7ad1f96d9036ed68fcfa1c363c9f64",
    "06eabcfb239749efc4907f6486bf3a5a0b3c6ed43efe989c61bbc80de7cb8b67",
    "07c1a40fb95d951619ce49b7509c42eac955cdf145c74e745dd8a0313e279d17",
    "0c4b30299a99c59db59032c163ee905aac7c50192b2e068cdb1f8374e0fe5a80",
    "104cedbe556197acf34789c0222fd7e006e13468c2de3a9f1c650e7323bf9b12",
    "1519a0a1226c0b7ce9d5e2b165921d105fdb6ab1a9677a0231e03df48653fa48",
    "15fabac69600e3ac3ddf0bf17b9a58d70f5e19b18a7682d66ae92a58ef4c05db",
    "1aa29bd922f93c08356aa7fbff5f13defc45cb74214b372ba0a931481f80a9a1",
    "2068f21a34e0dc481dfeb08c22c9702b0f103d35ecc0bbaab0e0650af54c4530",
    "20f0a756ec492c2f65bac354667860825f0dd437147b6d19abdd948dac2af4b6",
    "2b828dc8db517c0a94e77780f60b7dd426c2c7fea3e312efa9e780f01e73d7b4",
    "2cd1752d8e6ee5069872e0077ef5f85745391142b7954909261f8f80cb574d9b",
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
    "6e5005d040729aa8a385a016caaa4e72e1c229e081a9b96a2461dd26856929ce",
    "70edf553c6a6079fcba7b7cddb115e8626e0f7e97834c4fda88eee0b628af327",
    "75a8902550bde7580f44fc94d064a72ff702a7ae010d11c7ec4308ed09660ac1",
    "802d1a098436065268a5600c3d4257ddb196bc48a6fa637096757d6e77c343af",
    "8ca8a2f02e4b856083c2f46f9f45dabeae8ed2237b0ab50bf22b1968f927b9d3",
    "b6c82bd7eef9049091328eabbcbba5ad90ad327a2709f382c4ab4f841faf338d",
    "b8d988c73543dd4533b24be15a41e09b5697a01e1f2f7019e9e62eafd80b6806",
    "bb67b892b3568b6ead1466cf9ad2f356d0f322da68273c86baff00956780e0e3",
    "cc1d9b3d8f10bd49b92d8669c05563fa16e71e47e953f6999a8683c853dd948d",
    "cc8da9dddd06041bc03a55020c4ed1cb6fc3a136d27c6828459988965ac79161",
    "ddbd968924fb49dcbb03caa6ee001490f56e053098cf87de4bbf6414634d11e1",
    "dfcf971b1fba9ff2ebefcd2d6b8bde13f1a766affa740bf324afac0d3d192fef",
    "ea802f96d795049b985ed2bed1819856029db6b76ab785c0fa7cddebdeeabbca",
    "eec7a8fad7345b54053026146a27c9241200c9969ea7c0166160c2aca75101f0",
    "f3e7e4bc37b61df9d53af290b0731d27ccc19eac35392086954b23eb8b3ba1a8",
    "f4a14268f958ead9a95939cc8728d0deed415d840111b3803ab3c69485f801a7",
}
GUIDE_PUBLIES = {
    "0aae406c6aa7171535b9b5053a591c6ebd64e35d1fe9aae78809d7e7639f449b",
    "0f1dcd29b39dc2c82749de82e8e94ef47b311e9368301e955abba4681fa2eed6",
    "4a983e4c643ed98ed694bdb7b86e3937b25528000807a2ba90cb216f790a0a20",
    "5941f873e3bf2ba62c1de1497ee55516ca7f6874090c82bc80984b2f412c866c",
    "652453bbaae48d3ae91acc7265245960f1d14b0e4c9955e99a9b2888bab6caf0",
    "673e8fac6e2855751a1a39dbc66fc9874745fc8858dc6d3538a2400b584d0638",
    "6b96f9bcac5566dd8c1816e34b2679178b7d7377254bf7af4f3e210938284ee4",
    "6e7f200862a2406959db0a50ba2880f83a4f72d53c76d494e8a3a92234229303",
    "713bf8a5b957626bd24aa19af499a87da90d925a431a1c52a8d6f90a7376dd24",
    "71c6118e054f1aa4e423def26f3cef809ee0ddab083c90067a2c357bdc95a5e1",
    "72fa4d474e404c03aded586b2d3a708930b0fe9051f6896e1c0d36b02d4b8e9e",
    "79505a48e198c2e36e41ea0790ff93f0efacc66b6138f7a15a8fb9b7342bc60d",
    "8417ee3176eaa66259f4810976131900fd63003a9ae44b49171a6c51f37dfe77",
    "8741c438090f1c2024a41b44f0e13a17b22243b18ecff63161670494b05f5d5c",
    "882212f06956593e5b3ebd927596e9d399b4d6650bfabf85eb0dc5aec3be0899",
    "95f64234b4f9ea005b4a32db1abd8457ec24a58e40068f4301b08cf04bad2bcd",
    "a51456c0eb6e5f269e69584c509e8cda4c38c00a2191f1af1ef87986a782498e",
    "a7abc08a098b589f2cae8e03fbb7ac1dce2e790ee4c0d7962f8dc7605a180b2c",
    "b02f6d0ff7613edd2f3217a45adedc957ccc81055ab40cf8a9eb5c779611e9ed",
    "b264271439579c8c07a0f59935f8281f46a604a868af0d9f67a7302d9401112d",
    "b5871a30239ea8dadb0d683ce104b3459d2d7c0d7939225dd426672e9b0e8510",
    "becdb5a6703d5371c6acb0ecd9d2a3d4a696a1be6d441543fff3d6e5034024fc",
    "d4372b0bf3823b1e8eca7022c7162186407ae0863c32bb25273180a928d32994",
    "e7a0232a38f0c05b693d55496d790620ddbf79e1b4e87336a0d968eba56181d0",
}

def _remplace(src, nom, empreintes):
    """Reecrit l'ensemble `nom` (jusqu'a son accolade fermante) ; l'ajoute s'il manque."""
    corps = nom + " = {\n" + "".join(f'    "{e}",\n' for e in empreintes) + "}"
    tete = "\n" + nom + " = {"
    if tete not in src:
        i = src.index("\n\ndef _remplace")
        return src[:i] + "\n" + corps + src[i:]
    i = src.index(tete) + 1
    return src[:i] + corps + src[src.index("\n}", i) + 2:]


if __name__ == "__main__":
    import hashlib, os, subprocess
    ici = os.path.dirname(os.path.abspath(__file__))
    git = lambda *a: subprocess.run(["git", *a], cwd=ici, capture_output=True).stdout
    versions = [git("show", f"{t}:.claude/hooks/pt.py") for t in git("tag").decode().split()]
    versions.append(open(os.path.join(ici, "pt.py"), "rb").read())
    sha = sorted({hashlib.sha256(v).hexdigest() for v in versions if v})
    # b24 : chaque version de chaque fichier du moteur de guide jamais commitee, plus l'actuelle
    moteur = ".claude/hooks/plantrack_guide"
    blobs = set()
    for c in git("log", "--format=%H", "--", ":/" + moteur).decode().split():
        for ligne in git("ls-tree", "-r", "--full-tree", c).decode().splitlines():
            if ligne.split("\t", 1)[1].startswith(moteur + "/"):
                blobs.add(ligne.split()[2])
    guide = sorted({hashlib.sha256(git("cat-file", "blob", b)).hexdigest() for b in blobs}
                   | {hashlib.sha256(open(os.path.join(r, n), "rb").read()).hexdigest()
                      for r, _, fs in os.walk(os.path.join(ici, "plantrack_guide")) for n in fs})
    src = open(__file__, encoding="utf-8").read()
    src = _remplace(_remplace(src, "PUBLIES", sha), "GUIDE_PUBLIES", guide)
    with open(__file__, "w", encoding="utf-8") as f:
        f.write(src)
    print(f"{len(sha)} empreinte(s) pt.py, {len(guide)} empreinte(s) du moteur de guide")
